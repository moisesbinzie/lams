<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import { Badge } from '$lib/components/ui/badge';
	import LecturerNav from '$lib/components/lams/lecturer-nav.svelte';
	import LecturerCoursesPanel from '$lib/components/lams/lecturer-courses-panel.svelte';
	import { reportError } from '$lib/lams/notify.svelte';

	/**
	 * The lecturer's Lectures hub: their courses and who is taking each one.
	 *
	 * Staff only — students manage their own courses at `/courses`. Admins
	 * may open it too (their nav simply does not list it; the setup console
	 * at `/manage` stays their home).
	 */
	let token = getToken();
	let role = $state('');
	let isAdmin = $state(false);
	let ready = $state(false);

	onMount(async () => {
		if (!token) {
			void goto('/signin');
			return;
		}
		try {
			const client = requireConvexClient();
			const me = (await client.query(api.staff.me, { token })) as {
				kind: string;
				role: string;
				isAdmin?: boolean;
			} | null;
			if (!me) {
				endSession();
				void goto('/signin');
				return;
			}
			if (me.kind !== 'staff' || (me.role !== 'lecturer' && me.role !== 'admin')) {
				void goto('/home');
				return;
			}
			role = me.role;
			isAdmin = me.isAdmin === true || me.role === 'admin';
			ready = true;
		} catch (err) {
			reportError(err, 'Could not load.');
			void goto('/signin');
		}
	});
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 lg:max-w-5xl">
	<div class="flex items-center gap-3">
		<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
		<div>
			<h1 class="flex flex-wrap items-center gap-2 text-xl font-bold text-lams-navy">
				Lectures
				{#if isAdmin}
					<Badge class="bg-amber-600 text-white">Admin account</Badge>
				{:else}
					<Badge class="bg-lams-navy text-white">Lecturer account</Badge>
				{/if}
			</h1>
			<p class="text-xs text-muted-foreground">
				Your courses and who is taking each one. Add students from search, register new ones
				straight in, or withdraw anyone who should not be there.
			</p>
		</div>
	</div>

	{#if ready && (role === 'lecturer' || role === 'admin')}
		<LecturerNav />
		<LecturerCoursesPanel />
	{/if}
</div>
