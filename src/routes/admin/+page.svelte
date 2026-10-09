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
	import type { Offering, StaffRow } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	let token = getToken();
	let me = $state<{ username?: string; fullName?: string } | null>(null);
	let staff = $state<StaffRow[]>([]);
	let offerings = $state<Offering[]>([]);
	let loading = $state(true);
	let busy = $state(false);

	// New lecturer form (password is auto-generated).
	let newUsername = $state('');
	let newFullName = $state('');
	let created = $state<{ username: string; tempPassword: string } | null>(null);

	// Reset-password result, shown once.
	let resetResult = $state<{ username: string; tempPassword: string } | null>(null);

	const lecturers = $derived(staff.filter((s) => !s.isAdmin));
	const admins = $derived(staff.filter((s) => s.isAdmin));
	const unassigned = $derived(offerings.filter((o) => !o.lecturerId));

	const NO_LECTURER = 'unassigned';

	async function load() {
		const client = requireConvexClient();
		const [staffRows, offeringRows] = (await Promise.all([
			client.query(api.staff.listStaff, { token }),
			client.query(api.academics.listOfferings, { token })
		])) as [StaffRow[], Offering[]];
		staff = staffRows;
		offerings = offeringRows;
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

	async function toggleActive(id: string, active: boolean, username: string) {
		if (!active && !confirm(`Switch off ${username}? They will be signed out immediately.`)) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.staff.setActive, { token, staffId: id as never, active });
			await load();
			reportSuccess(active ? 'Account re-enabled.' : 'Account switched off.');
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
				Signed in as <strong>{me?.username ?? '…'}</strong>. Create lecturer accounts, reset passwords, and
				assign each subject to the lecturer teaching it. Lecturers sign in with their username and the
				temporary password you give them, then change it in Settings.
			</p>
		</div>
	</div>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else}
		<LecturerNav />

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
					to them. Admins ({admins.length}) see everything.
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
									<Table.Head>Status</Table.Head>
									<Table.Head class="text-right">Actions</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each lecturers as s (s._id)}
									<Table.Row>
										<Table.Cell class="font-medium">{s.username}</Table.Cell>
										<Table.Cell class="text-xs">{s.fullName}</Table.Cell>
										<Table.Cell>
											<Badge variant="secondary">{s.assignmentCount}</Badge>
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
												<Button variant="outline" size="sm" onclick={() => resetPassword(s._id, s.username)}>
													Reset password
												</Button>
												<Button
													variant="outline"
													size="sm"
													onclick={() => toggleActive(s._id, !s.active, s.username)}
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
