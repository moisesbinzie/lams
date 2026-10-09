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
	import type { Offering } from '$lib/lams/types';
	import LecturerNav from '$lib/components/lams/lecturer-nav.svelte';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	let token = getToken();
	let me = $state<{
		role: string;
		isAdmin?: boolean;
		mustChangePassword?: boolean;
		username?: string;
		fullName?: string;
	} | null>(null);
	let offerings = $state<Offering[]>([]);
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let busy = $state(false);
	let loading = $state(true);

	const isAdmin = $derived(me?.isAdmin === true || me?.role === 'admin');

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
				mustChangePassword?: boolean;
				username?: string;
				fullName?: string;
			} | null;
			if (!profile || profile.kind !== 'staff') {
				endSession();
				void goto('/signin');
				return;
			}
			if (profile.role !== 'lecturer' && profile.role !== 'admin') {
				void goto('/home');
				return;
			}
			me = profile;
			if (!isAdmin) {
				offerings = (await client.query(api.academics.listOfferings, { token })) as unknown as Offering[];
			}
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
			if (me) me.mustChangePassword = false;
			reportSuccess('Password changed. Use the new one next time you sign in.');
		} catch (err) {
			reportError(err, 'Could not change the password.');
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-col gap-6">
	<div class="text-center">
		<h1 class="text-2xl font-bold text-lams-navy">{isAdmin ? 'Admin settings' : 'Lecturer settings'}</h1>
		<p class="text-sm text-muted-foreground">Your sign-in details.</p>
	</div>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else if me}
		<LecturerNav />
		{#if me.mustChangePassword}
			<p class="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
				<strong>You are using a temporary password.</strong> Choose your own below — keep it private,
				and don't reuse it anywhere else.
			</p>
		{/if}
		<Card.Root>
			<Card.Header>
				<Card.Title>Change your password</Card.Title>
				<Card.Description>
					You are signed in as <strong>{me.username}</strong> ({me.fullName}).
					{#if isAdmin}
						<span class="ml-1"><Badge variant="secondary">Admin</Badge></span>
					{:else}
						<span class="ml-1"><Badge variant="secondary">Lecturer</Badge></span>
					{/if}
					Anyone who knows this password can act as you, so keep it private.
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

		{#if isAdmin}
			<Card.Root>
				<Card.Header>
					<Card.Title>Lecturer accounts</Card.Title>
					<Card.Description>
						Lecturer accounts now live in the admin console, where you can create accounts and assign subjects.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<Button href="/admin">Open the admin console</Button>
				</Card.Content>
			</Card.Root>
		{:else}
			<Card.Root>
				<Card.Header>
					<Card.Title>My subjects ({offerings.length})</Card.Title>
					<Card.Description>
						Subjects assigned to you by the admin. If one is missing, ask the admin to assign it.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if offerings.length === 0}
						<p class="text-sm text-muted-foreground">No subjects assigned yet.</p>
					{:else}
						<ul class="flex flex-col divide-y divide-border">
							{#each offerings as o (o._id)}
								<li class="py-2 text-sm">
									<strong>{o.subjectCode}</strong> — {o.subjectTitle}
									<span class="text-xs text-muted-foreground">· {o.className} · {o.semesterName}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>
