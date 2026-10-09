<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import type { StaffRow } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	/**
	 * Staff accounts: lecturers, admins, and the trail of what was done to them.
	 *
	 * Split out of the admin page, which had grown to 755 lines of mixed
	 * concerns. This panel owns the account lifecycle and nothing else — the
	 * structure it feeds (programs, courses, students) lives in the setup
	 * console, and the two are deliberately not on the same screen.
	 *
	 * `onsaved` fires after any change that moves the numbers the admin overview
	 * shows, so the tiles above never disagree with the tables below.
	 */
	let {
		token,
		staff = $bindable<StaffRow[]>([]),
		lectureStats = []
	}: {
		token: string;
		staff?: StaffRow[];
		lectureStats?: {
			_id: string;
			assignmentCount: number;
			lecturesTotal: number;
			lecturesOpen: number;
			lecturesClosed: number;
			lastLectureAt: number | null;
		}[];
	} = $props();

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
		'offering.assign-lecturer': 'Assigned course',
		'rep.grant': 'Made program rep',
		'rep.revoke': 'Removed program rep',
		'person.set-blocked': 'Suspended student',
		'person.set-active': 'Unsuspended student',
		'person.reset-pin': 'Reset student PIN',
		'person.clear-device': 'Moved student to new phone',
		'attendance.excuse-range': 'Bulk status change'
	};

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
	const statById = $derived(new Map(lectureStats.map((s) => [String(s._id), s])));

	export async function reload() {
		try {
			const client = requireConvexClient();
			const [rows, stats, auditRows] = (await Promise.all([
				client.query(api.staff.listStaff, { token }),
				client.query(api.staff.lecturerStats, { token }),
				client.query(api.staff.listAudit, { token, limit: 50 })
			])) as [StaffRow[], typeof lectureStats, AuditRow[]];
			staff = rows;
			lectureStats = stats;
			audit = auditRows;
		} catch (err) {
			reportError(err, 'Could not load the staff accounts.');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (token) void reload();
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
			await reload();
			reportSuccess(
				'Lecturer account created. Share the temporary password once — it is not shown again.',
				9000
			);
		} catch (err) {
			reportError(err, 'Could not create that account.');
		} finally {
			busy = false;
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
			await reload();
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
						? ` Their ${assignments} course(s) will become unassigned — reassign them on the Programs tab.`
						: '')
			)
		)
			return;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.staff.setActive, {
				token,
				staffId: id as never,
				active
			})) as { released: number };
			await reload();
			reportSuccess(
				active
					? 'Account re-enabled.'
					: res.released > 0
						? `Account switched off. ${res.released} course(s) unassigned — assign them on the Programs tab.`
						: 'Account switched off.'
			);
		} catch (err) {
			reportError(err, 'Could not change that account.');
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
			await reload();
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

<div class="flex flex-col gap-4">
	{#if created}
		<div class="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm" role="status">
			<p class="font-semibold">Account created for {created.username}</p>
			<p class="mt-1">
				Temporary password: <code class="rounded bg-white px-2 py-1 font-mono font-bold">{created.tempPassword}</code>
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				Share this once — it is never shown again. They change it in Settings.
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

	{#if loading}
		<div class="flex flex-col gap-2">
			<div class="h-8 w-64 animate-pulse rounded-md bg-muted"></div>
			<div class="h-40 animate-pulse rounded-md bg-muted"></div>
		</div>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title>Lecturers ({lecturers.length})</Card.Title>
				<Card.Description>
					Each lecturer gets their own username and temporary password, and only sees the courses
					assigned to them. Lectures taken counts their attendance sessions across those courses.
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
						No lecturers yet. Create the first one above — they sign in on the lecturer door with
						the temporary password.
					</p>
				{:else}
					<div class="overflow-x-auto rounded-md border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Username</Table.Head>
									<Table.Head>Name</Table.Head>
									<Table.Head>Courses</Table.Head>
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
											<Button variant="outline" size="sm" onclick={() => openEdit(s)}>Edit</Button>
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
	{/if}
</div>
