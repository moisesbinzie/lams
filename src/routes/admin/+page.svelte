<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import * as Select from '$lib/components/ui/select';
	import LecturerNav from '$lib/components/lams/lecturer-nav.svelte';
	import type { ClassRow, Offering, StaffRow, Subject } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	interface LecturerStat {
		_id: string;
		assignmentCount: number;
		lecturesTotal: number;
		lecturesOpen: number;
		lecturesClosed: number;
		lastLectureAt: number | null;
	}

	interface AuditRow {
		_id: string;
		actorName: string;
		action: string;
		targetName: string | null;
		detail: string | null;
		createdAt: number;
	}

	const AUDIT_LABELS: Record<string, string> = {
		'staff.create-lecturer': 'Created lecturer',
		'staff.create-admin': 'Created admin',
		'staff.create-manual': 'Created account (manual password)',
		'staff.reset-password': 'Reset password',
		'staff.set-active': 'Re-enabled account',
		'staff.set-inactive': 'Switched off account',
		'staff.update': 'Updated account',
		'offering.assign-lecturer': 'Assigned subject',
		'rep.grant': 'Made class rep',
		'rep.revoke': 'Removed class rep',
		'person.set-blocked': 'Suspended student',
		'person.set-active': 'Unsuspended student',
		'person.reset-pin': 'Reset student PIN',
		'person.clear-device': 'Moved student to new phone',
		'attendance.excuse-range': 'Bulk status change'
	};

	let token = getToken();
	let me = $state<{ username?: string; fullName?: string } | null>(null);
	let staff = $state<StaffRow[]>([]);
	let offerings = $state<Offering[]>([]);
	let subjects = $state<Subject[]>([]);
	let classes = $state<ClassRow[]>([]);
	let lectureStats = $state<LecturerStat[]>([]);
	let audit = $state<AuditRow[]>([]);
	let loading = $state(true);
	let busy = $state(false);

	// New lecturer form (password is auto-generated).
	let newUsername = $state('');
	let newFullName = $state('');

	// New admin form (same generated-password flow).
	let newAdminUsername = $state('');
	let newAdminFullName = $state('');
	let created = $state<{ username: string; tempPassword: string } | null>(null);

	// Reset-password result, shown once.
	let resetResult = $state<{ username: string; tempPassword: string } | null>(null);

	// Rename form state.
	let editingId = $state('');
	let editUsername = $state('');
	let editFullName = $state('');
	let savingEdit = $state(false);

	const lecturers = $derived(staff.filter((s) => !s.isAdmin));
	const admins = $derived(staff.filter((s) => s.isAdmin));
	const activeLecturers = $derived(lecturers.filter((s) => s.active));
	const unassigned = $derived(offerings.filter((o) => !o.lecturerId));
	const assignedCount = $derived(offerings.length - unassigned.length);

	const NO_LECTURER = 'unassigned';

	const statById = $derived(new Map(lectureStats.map((s) => [String(s._id), s])));

	async function load() {
		const client = requireConvexClient();
		const [staffRows, offeringRows, subjectRows, classRows, statRows, auditRows] = (await Promise.all([
			client.query(api.staff.listStaff, { token }),
			client.query(api.academics.listOfferings, { token }),
			client.query(api.academics.listSubjects, { token }),
			client.query(api.academics.listClasses, { token }),
			client.query(api.staff.lecturerStats, { token }),
			client.query(api.staff.listAudit, { token, limit: 50 })
		])) as [StaffRow[], Offering[], Subject[], ClassRow[], LecturerStat[], AuditRow[]];
		staff = staffRows;
		offerings = offeringRows;
		subjects = subjectRows;
		classes = classRows;
		lectureStats = statRows;
		audit = auditRows;
	}

	onMount(async () => {
		if (!token) {
			void goto('/signin');
			return;
		}
		try {
			const client = requireConvexClient();
			const profile = (await client.query(api.staff.me, { token })) as {
				kind: string;
				role: string;
				isAdmin?: boolean;
				username?: string;
				fullName?: string;
			} | null;
			if (!profile || profile.kind !== 'staff') {
				endSession();
				void goto('/signin');
				return;
			}
			if (profile.role !== 'admin' && profile.isAdmin !== true) {
				// Lecturers have their own scoped console; students have home.
				void goto(profile.role === 'lecturer' ? '/manage' : '/home');
				return;
			}
			me = profile;
			await load();
		} catch (err) {
			reportError(err, 'Could not load the admin console.');
		} finally {
			loading = false;
		}
	});

	async function createLecturer(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		created = null;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.staff.createLecturer, {
				token,
				username: newUsername.trim(),
				fullName: newFullName.trim()
			})) as { username: string; tempPassword: string };
			created = res;
			newUsername = '';
			newFullName = '';
			await load();
			reportSuccess('Lecturer account created. Share the temporary password once — it is not shown again.', 9000);
		} catch (err) {
			reportError(err, 'Could not create that account.');
		} finally {
			busy = false;
		}
	}

	async function resetPassword(id: string, username: string) {
		if (!confirm(`Reset the password for ${username}? They will be signed out everywhere.`)) return;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.staff.resetLecturerPassword, {
				token,
				staffId: id as never
			})) as { tempPassword: string };
			resetResult = { username, tempPassword: res.tempPassword };
			reportSuccess('New temporary password generated. Share it once — it is not shown again.', 9000);
		} catch (err) {
			reportError(err, 'Could not reset that password.');
		}
	}

	async function toggleActive(id: string, active: boolean, username: string, assignments = 0) {
		if (
			!active &&
			!confirm(
				`Switch off ${username}? They will be signed out immediately.` +
					(assignments > 0
						? ` Their ${assignments} subject(s) will become unassigned — reassign them below.`
						: '')
			)
		)
			return;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.staff.setActive, { token, staffId: id as never, active })) as {
				released: number;
			};
			await load();
			reportSuccess(
				active
					? 'Account re-enabled.'
					: res.released > 0
						? `Account switched off. ${res.released} subject(s) unassigned below.`
						: 'Account switched off.'
			);
		} catch (err) {
			reportError(err, 'Could not change that account.');
		}
	}

	async function assignLecturer(offeringId: string, value: string) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.setOfferingLecturer, {
				token,
				id: offeringId as never,
				lecturerId: value === NO_LECTURER ? null : (value as never)
			});
			await load();
			reportSuccess(value === NO_LECTURER ? 'Offering unassigned.' : 'Lecturer assigned.');
		} catch (err) {
			reportError(err, 'Could not assign that offering.');
		}
	}

	async function createAdminAcc(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		created = null;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.staff.createAdmin, {
				token,
				username: newAdminUsername.trim(),
				fullName: newAdminFullName.trim()
			})) as { username: string; tempPassword: string };
			created = res;
			newAdminUsername = '';
			newAdminFullName = '';
			await load();
			reportSuccess(
				'Admin account created. Share the temporary password once — it is not shown again.',
				9000
			);
		} catch (err) {
			reportError(err, 'Could not create that account.');
		} finally {
			busy = false;
		}
	}

	function openEdit(s: StaffRow) {
		editingId = s._id;
		editUsername = s.username;
		editFullName = s.fullName;
		created = null;
		resetResult = null;
	}

	async function saveEdit(e: SubmitEvent) {
		e.preventDefault();
		savingEdit = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.staff.updateStaff, {
				token,
				staffId: editingId as never,
				username: editUsername.trim(),
				fullName: editFullName.trim()
			});
			editingId = '';
			await load();
			reportSuccess('Account updated. Past records keep their original name snapshots.');
		} catch (err) {
			reportError(err, 'Could not update that account.');
		} finally {
			savingEdit = false;
		}
	}

	function copyPassword(pw: string) {
		void navigator.clipboard?.writeText(pw).then(
			() => reportSuccess('Copied.'),
			() => reportError(new Error('Copy failed'), 'Could not copy.')
		);
	}
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 lg:max-w-5xl">
	<div class="flex items-center gap-3">
		<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
		<div>
			<h1 class="flex flex-wrap items-center gap-2 text-xl font-bold text-lams-navy">
				Admin console <Badge class="bg-amber-600 text-white">Admin account</Badge>
			</h1>
			<p class="text-xs text-muted-foreground">
				Signed in as <strong>{me?.username ?? '…'}</strong>. Work through the setup below: create
				lecturer accounts, offer subjects to classes in Set up, then assign each offering to its
				lecturer. Lecturers sign in with their username and the temporary password you give them.
			</p>
		</div>
	</div>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else}
		<LecturerNav />

		<section aria-label="Overview" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
			<Card.Root>
				<Card.Content class="pt-5 text-center">
					<p class="text-3xl font-extrabold text-lams-navy">{activeLecturers.length}</p>
					<p class="text-xs text-muted-foreground">
						Active lecturer{activeLecturers.length === 1 ? '' : 's'}
						{#if lecturers.length !== activeLecturers.length}
							({lecturers.length} total)
						{/if}
					</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="pt-5 text-center">
					<p class="text-3xl font-extrabold text-lams-navy">{subjects.length}</p>
					<p class="text-xs text-muted-foreground">Subject{subjects.length === 1 ? '' : 's'} in catalogue</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Content class="pt-5 text-center">
					<p class="text-3xl font-extrabold text-lams-navy">{classes.length}</p>
					<p class="text-xs text-muted-foreground">Class{classes.length === 1 ? '' : 'es'}</p>
				</Card.Content>
			</Card.Root>
			<Card.Root class={unassigned.length > 0 ? 'border-amber-300' : ''}>
				<Card.Content class="pt-5 text-center">
					<p class="text-3xl font-extrabold text-lams-navy">
						{assignedCount}<span class="text-lg text-muted-foreground">/{offerings.length}</span>
					</p>
					<p class="text-xs text-muted-foreground">
						{#if unassigned.length > 0}
							<span class="font-semibold text-amber-700">{unassigned.length} need a lecturer</span>
						{:else if offerings.length > 0}
							Offerings assigned
						{:else}
							Offerings assigned
						{/if}
					</p>
				</Card.Content>
			</Card.Root>
		</section>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Getting started</Card.Title>
				<Card.Description>Three steps, in order. Each one unlocks the next.</Card.Description>
			</Card.Header>
			<Card.Content>
				<ol class="flex flex-col gap-3">
					<li class="flex flex-wrap items-center justify-between gap-2 text-sm">
						<span>
							<strong>1. Create lecturer accounts</strong>
							<span class="block text-xs text-muted-foreground">Usernames plus a generated temporary password.</span>
						</span>
						<span class="flex items-center gap-2">
							{#if lecturers.length > 0}
								<Badge class="bg-emerald-600 text-white">Done</Badge>
							{:else}
								<Badge variant="secondary">To do</Badge>
							{/if}
						</span>
					</li>
					<li class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
						<span>
							<strong>2. Set up semesters, classes and subjects</strong>
							<span class="block text-xs text-muted-foreground">Offer catalogue subjects to classes for a semester.</span>
						</span>
						<span class="flex items-center gap-2">
							{#if offerings.length > 0}
								<Badge class="bg-emerald-600 text-white">Done</Badge>
							{:else}
								<Badge variant="secondary">To do</Badge>
							{/if}
							<Button size="sm" variant="outline" href="/manage">Open Set up</Button>
						</span>
					</li>
					<li class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
						<span>
							<strong>3. Assign every offering a lecturer</strong>
							<span class="block text-xs text-muted-foreground">A lecturer only sees their own subjects.</span>
						</span>
						<span class="flex items-center gap-2">
							{#if offerings.length > 0 && unassigned.length === 0}
								<Badge class="bg-emerald-600 text-white">Done</Badge>
							{:else}
								<Badge variant="secondary">To do</Badge>
							{/if}
							<Button size="sm" variant="outline" href="#assignments">Review below</Button>
						</span>
					</li>
				</ol>
			</Card.Content>
		</Card.Root>

		{#if created}
			<div class="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm" role="status">
				<p class="font-semibold">Account created for {created.username}</p>
				<p class="mt-1">
					Temporary password: <code class="rounded bg-white px-2 py-1 font-mono font-bold">{created.tempPassword}</code>
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					Share this once — it is never shown again. The lecturer changes it in Settings.
				</p>
				<div class="mt-2 flex gap-2">
					<Button size="sm" variant="outline" onclick={() => copyPassword(created?.tempPassword ?? '')}>
						Copy password
					</Button>
					<Button size="sm" variant="ghost" onclick={() => (created = null)}>Dismiss</Button>
				</div>
			</div>
		{/if}

		{#if resetResult}
			<div class="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm" role="status">
				<p class="font-semibold">New password for {resetResult.username}</p>
				<p class="mt-1">
					Temporary password: <code class="rounded bg-white px-2 py-1 font-mono font-bold">{resetResult.tempPassword}</code>
				</p>
				<p class="mt-1 text-xs text-muted-foreground">Share this once — it is never shown again.</p>
				<div class="mt-2 flex gap-2">
					<Button size="sm" variant="outline" onclick={() => copyPassword(resetResult?.tempPassword ?? '')}>
						Copy password
					</Button>
					<Button size="sm" variant="ghost" onclick={() => (resetResult = null)}>Dismiss</Button>
				</div>
			</div>
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title>Lecturers ({lecturers.length})</Card.Title>
				<Card.Description>
					Each lecturer gets their own username and temporary password, and only sees the subjects assigned
					to them. Lectures taken counts their attendance sessions across those subjects.
					Admins ({admins.length}) see everything.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<form class="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_2fr_auto]" onsubmit={createLecturer}>
					<div class="flex flex-col gap-1">
						<Label for="lu">Username</Label>
						<Input id="lu" bind:value={newUsername} placeholder="e.g. j.mwale" required />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="ln">Full name</Label>
						<Input id="ln" bind:value={newFullName} placeholder="e.g. Jane Mwale" required />
					</div>
					<div class="flex items-end">
						<Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create lecturer'}</Button>
					</div>
				</form>
				<p class="text-xs text-muted-foreground">
					The password is generated for you — no need to invent one. Usernames are 3–32 characters:
					letters, numbers, dot, dash or underscore.
				</p>

				{#if editingId}
					<form class="grid gap-2 rounded-md border border-amber-300 bg-amber-50/50 p-3 sm:grid-cols-[1fr_2fr_auto_auto]" onsubmit={saveEdit}>
						<div class="flex flex-col gap-1">
							<Label for="eu">Username</Label>
							<Input id="eu" bind:value={editUsername} required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="en">Full name</Label>
							<Input id="en" bind:value={editFullName} required />
						</div>
						<div class="flex items-end">
							<Button type="submit" disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save'}</Button>
						</div>
						<div class="flex items-end">
							<Button type="button" variant="ghost" onclick={() => (editingId = '')}>Cancel</Button>
						</div>
					</form>
				{/if}

				{#if lecturers.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						No lecturers yet. Create the first one above — they will sign in on the lecturer door with the
						temporary password.
					</p>
				{:else}
					<div class="overflow-x-auto rounded-md border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Username</Table.Head>
									<Table.Head>Name</Table.Head>
									<Table.Head>Subjects</Table.Head>
									<Table.Head>Lectures taken</Table.Head>
									<Table.Head>Status</Table.Head>
									<Table.Head class="text-right">Actions</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each lecturers as s (s._id)}
									{@const stat = statById.get(String(s._id))}
									<Table.Row>
										<Table.Cell class="font-medium">{s.username}</Table.Cell>
										<Table.Cell class="text-xs">{s.fullName}</Table.Cell>
										<Table.Cell>
											<Badge variant="secondary">{s.assignmentCount}</Badge>
										</Table.Cell>
										<Table.Cell>
											<span class="font-semibold">{stat?.lecturesTotal ?? 0}</span>
											{#if (stat?.lecturesOpen ?? 0) > 0}
												<Badge class="ml-1 bg-emerald-600 text-white">
													{stat?.lecturesOpen} open
												</Badge>
											{/if}
											{#if stat?.lastLectureAt}
												<span class="block text-xs text-muted-foreground">
													last {new Date(stat.lastLectureAt).toLocaleDateString()}
												</span>
											{/if}
										</Table.Cell>
										<Table.Cell>
											{#if !s.active}
												<Badge class="bg-red-600 text-white">Switched off</Badge>
											{:else}
												<Badge variant="secondary">Active</Badge>
											{/if}
										</Table.Cell>
										<Table.Cell class="text-right">
											<div class="flex flex-wrap justify-end gap-1">
												<Button variant="outline" size="sm" onclick={() => openEdit(s)}>
													Edit
												</Button>
												<Button variant="outline" size="sm" onclick={() => resetPassword(s._id, s.username)}>
													Reset password
												</Button>
												<Button
													variant="outline"
													size="sm"
													onclick={() => toggleActive(s._id, !s.active, s.username, s.assignmentCount)}
												>
													{s.active ? 'Switch off' : 'Switch on'}
												</Button>
											</div>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Administrators ({admins.length})</Card.Title>
				<Card.Description>
					Admins see everything and manage accounts. Keep at least two active so one lost
					password never locks everyone out.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<form class="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_2fr_auto]" onsubmit={createAdminAcc}>
					<div class="flex flex-col gap-1">
						<Label for="au">Username</Label>
						<Input id="au" bind:value={newAdminUsername} placeholder="e.g. office.admin" required />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="an">Full name</Label>
						<Input id="an" bind:value={newAdminFullName} placeholder="e.g. Office Admin" required />
					</div>
					<div class="flex items-end">
						<Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create admin'}</Button>
					</div>
				</form>

				<div class="overflow-x-auto rounded-md border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Username</Table.Head>
								<Table.Head>Name</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head class="text-right">Actions</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each admins as s (s._id)}
								<Table.Row>
									<Table.Cell class="font-medium">{s.username}</Table.Cell>
									<Table.Cell class="text-xs">{s.fullName}</Table.Cell>
									<Table.Cell>
										{#if !s.active}
											<Badge class="bg-red-600 text-white">Switched off</Badge>
										{:else}
											<Badge class="bg-amber-600 text-white">Admin</Badge>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right">
										<div class="flex flex-wrap justify-end gap-1">
											<Button variant="outline" size="sm" onclick={() => openEdit(s)}>
												Edit
											</Button>
											<Button
												variant="outline"
												size="sm"
												onclick={() => toggleActive(s._id, !s.active, s.username, s.assignmentCount)}
											>
												{s.active ? 'Switch off' : 'Switch on'}
											</Button>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Recent activity ({audit.length})</Card.Title>
				<Card.Description>
					Who did what across accounts, assignments and student access. Newest first.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if audit.length === 0}
					<p class="text-sm text-muted-foreground">Nothing recorded yet.</p>
				{:else}
					<div class="overflow-x-auto rounded-md border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>When</Table.Head>
									<Table.Head>Who</Table.Head>
									<Table.Head>What</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each audit as a (a._id)}
									<Table.Row>
										<Table.Cell class="text-xs whitespace-nowrap text-muted-foreground">
											{new Date(a.createdAt).toLocaleString()}
										</Table.Cell>
										<Table.Cell class="text-xs font-medium">{a.actorName}</Table.Cell>
										<Table.Cell class="text-xs">
											{AUDIT_LABELS[a.action] ?? a.action}
											{#if a.targetName}
												<strong> {a.targetName}</strong>
											{/if}
											{#if a.detail}
												<span class="block text-muted-foreground">{a.detail}</span>
											{/if}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root id="assignments" class="scroll-mt-24">
			<Card.Header>
				<Card.Title>Subject assignments ({offerings.length})</Card.Title>
				<Card.Description>
					A lecturer may teach one or more subjects. Assign each offered subject to its lecturer — a
					lecturer only sees their own.
					{#if unassigned.length > 0}
						<span class="font-semibold text-amber-700">{unassigned.length} unassigned.</span>
					{:else}
						Every subject has a lecturer.
					{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				{#if offerings.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						No subjects offered yet. Offer subjects to classes in “Set up”, then assign them here.
					</p>
				{:else}
					<ul class="flex flex-col divide-y divide-border">
						{#each offerings as o (o._id)}
							<li class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<p class="text-sm font-semibold">{o.subjectCode} — {o.subjectTitle}</p>
									<p class="text-xs text-muted-foreground">
										{o.className} · {o.semesterName} · {o.studentCount} student(s)
									</p>
								</div>
								<div class="w-full sm:w-56">
									<Select.Root
										type="single"
										value={o.lecturerId ?? NO_LECTURER}
										onValueChange={(v) => {
											if (v) void assignLecturer(o._id, v);
										}}
									>
										<Select.Trigger class="w-full">
											<Select.Value placeholder="Assign a lecturer" />
										</Select.Trigger>
										<Select.Content>
											<Select.Group>
												<Select.Item value={NO_LECTURER} label="Unassigned">Unassigned</Select.Item>
												{#each lecturers as l (l._id)}
													<Select.Item
														value={l._id}
														label={`${l.fullName} (${l.username})`}
														disabled={!l.active}
													>
														{l.fullName} ({l.username}){l.active ? '' : ' — switched off'}
													</Select.Item>
												{/each}
											</Select.Group>
										</Select.Content>
									</Select.Root>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
