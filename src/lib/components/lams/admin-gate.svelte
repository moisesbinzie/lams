<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { clearAdminPassword, getAdminPassword, setAdminPassword } from '$lib/lams/admin';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { LockKeyhole, LockOpen, ShieldCheck } from '@lucide/svelte';

	let {
		title = 'Unlock admin tools',
		description = 'One shared admin password protects all lecturer and class-rep actions.',
		onUnlock
	}: { title?: string; description?: string; onUnlock: (password: string) => void } = $props();

	let password = $state(getAdminPassword());
	let unlocked = $state(getAdminPassword().length > 0);
	let error = $state('');
	let busy = $state(false);

	async function unlock(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.settings.ensureSeed, {});
			const res = await client.mutation(api.settings.verifyAdmin, { password });
			if (!res.ok) {
				error = 'Wrong password. The default is admin123 — change it after first login.';
				return;
			}
			setAdminPassword(password);
			unlocked = true;
			onUnlock(password);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unlock failed.';
		} finally {
			busy = false;
		}
	}

	function lock() {
		clearAdminPassword();
		unlocked = false;
		onUnlock('');
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<ShieldCheck class="size-5 text-lams-navy" />
			{title}
		</Card.Title>
		<Card.Description>{description}</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if unlocked}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<p class="flex items-center gap-2 text-sm text-muted-foreground">
					<LockOpen class="size-4 text-emerald-600" />
					Unlocked for this browser tab. Continue below.
				</p>
				<Button variant="outline" size="sm" onclick={lock}>
					<LockKeyhole class="size-3.5" /> Lock
				</Button>
			</div>
		{:else}
			<form class="flex flex-col gap-4" onsubmit={unlock}>
				<div class="flex flex-col gap-1.5">
					<Label for="adminPw">Admin password</Label>
					<Input
						id="adminPw"
						type="password"
						bind:value={password}
						placeholder="Default: admin123"
						autocomplete="current-password"
						required
					/>
				</div>
				{#if error}
					<p class="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800" role="alert">
						{error}
					</p>
				{/if}
				<Button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</Button>
			</form>
		{/if}
	</Card.Content>
</Card.Root>
