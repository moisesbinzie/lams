<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
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
	import type { StaffRow } from '$lib/lams/types';
	import LecturerNav from '$lib/components/lams/lecturer-nav.svelte';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	let token = getToken();
	let me = $state<{ role: string; username?: string; fullName?: string } | null>(null);
	let staff = $state<StaffRow[]>([]);
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let busy = $state(false);
	let loading = $state(true);

	// Fields for adding another lecturer.
	let showAdd = $state(false);
	let newUsername = $state('');
	let newStaffPassword = $state('');
	let newStaffName = $state('');

	onMount(async () => {
		if (!token) {
			void goto('/signin');
			return;
		}
		try {
			const client = requireConvexClient();
			const profile = (await client.query(api.staff.me, { token })) as {
				role: string;
				username?: string;
				fullName?: string;
			} | null;
			if (!profile) {
				endSession();
				void goto('/signin');
				return;
			}
			if (profile.role !== 'lecturer') {
				void goto('/home');
				return;
			}
			me = profile;
			staff = (await client.query(api.staff.listStaff, { token })) as unknown as StaffRow[];
		} catch (err) {
			reportError(err, 'Could not load your settings.');
		} finally {
			loading = false;
		}
	});

	async function savePassword(e: SubmitEvent) {
		e.preventDefault();
		if (newPassword !== confirmPassword) {
			toast.error('The two passwords do not match.');
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.staff.changePassword, {
				token,
				currentPassword,
				newPassword: newPassword.trim()
			});
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			reportSuccess('Password changed. Use the new one next time you sign in.');
		} catch (err) {
			reportError(err, 'Could not change the password.');
		} finally {
			busy = false;
		}
	}

	async function addStaff(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.staff.createStaff, {
				token,
				username: newUsername.trim(),
				password: newStaffPassword,
				fullName: newStaffName.trim()
			});
			newUsername = '';
			newStaffPassword = '';
			newStaffName = '';
			showAdd = false;
			staff = (await client.query(api.staff.listStaff, { token })) as unknown as StaffRow[];
			reportSuccess('Lecturer account created.');
		} catch (err) {
			reportError(err, 'Could not create that account.');
		} finally {
			busy = false;
		}
	}

	async function toggleActive(id: string, active: boolean) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.staff.setActive, { token, staffId: id as never, active });
			staff = (await client.query(api.staff.listStaff, { token })) as unknown as StaffRow[];
			reportSuccess(active ? 'Account re-enabled.' : 'Account switched off.');
		} catch (err) {
			reportError(err, 'Could not change that account.');
		}
	}
</script>

<div class="flex flex-col gap-6">
	<div class="text-center">
		<h1 class="text-2xl font-bold text-lams-navy">Lecturer settings</h1>
		<p class="text-sm text-muted-foreground">Your sign-in details and other lecturer accounts.</p>
	</div>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else if me?.role === 'lecturer'}
		<LecturerNav />
		<Card.Root>
			<Card.Header>
				<Card.Title>Change your password</Card.Title>
				<Card.Description>
					You are signed in as <strong>{me.username}</strong> ({me.fullName}). Anyone who knows this
					password can manage classes and change any record, so keep it private.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form class="flex flex-col gap-3" onsubmit={savePassword}>
					<div class="flex flex-col gap-1.5">
						<Label for="cur">Current password</Label>
						<Input id="cur" type="password" bind:value={currentPassword} autocomplete="current-password" required />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="np">New password (min 6 characters)</Label>
						<Input id="np" type="password" bind:value={newPassword} autocomplete="new-password" required />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="cp">Type it again</Label>
						<Input id="cp" type="password" bind:value={confirmPassword} autocomplete="new-password" required />
					</div>
					<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</Button>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center justify-between gap-2">
					<span>Lecturer accounts ({staff.length})</span>
					<Button size="sm" onclick={() => (showAdd = !showAdd)}>
						{showAdd ? 'Close' : 'Add a lecturer'}
					</Button>
				</Card.Title>
				<Card.Description>
					Add one if more than one person uses this system. Each has their own username so you can tell who
					was working.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				{#if showAdd}
					<form class="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_2fr_auto]" onsubmit={addStaff}>
						<div class="flex flex-col gap-1">
							<Label for="nu">Username</Label>
							<Input id="nu" bind:value={newUsername} required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="nsp">Password</Label>
							<Input id="nsp" type="password" bind:value={newStaffPassword} required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="nn">Full name</Label>
							<Input id="nn" bind:value={newStaffName} required />
						</div>
						<div class="flex items-end">
							<Button type="submit" disabled={busy}>Create</Button>
						</div>
					</form>
				{/if}

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
							{#each staff as s (s._id)}
								<Table.Row>
									<Table.Cell class="font-medium">{s.username}</Table.Cell>
									<Table.Cell class="text-xs">{s.fullName}</Table.Cell>
									<Table.Cell>
										{#if !s.active}
											<Badge class="bg-red-600 text-white">Switched off</Badge>
										{:else if s.isDefault}
											<Badge variant="secondary">Default</Badge>
										{:else}
											<Badge variant="secondary">Active</Badge>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right">
										{#if s.username !== me.username}
											<Button variant="outline" size="sm" onclick={() => toggleActive(s._id, !s.active)}>
												{s.active ? 'Switch off' : 'Switch on'}
											</Button>
										{:else}
											<span class="text-xs text-muted-foreground">This is you</span>
										{/if}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>