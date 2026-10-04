<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import { Button } from '$lib/components/ui/button';
	import * as Tabs from '$lib/components/ui/tabs';
	import SetupPanel from '$lib/components/lams/setup-panel.svelte';
	import PeoplePanel from '$lib/components/lams/people-panel.svelte';
	import SubjectsPanel from '$lib/components/lams/subjects-panel.svelte';
	import TimetablePanel from '$lib/components/lams/timetable-panel.svelte';
	import LecturePanel from '$lib/components/lams/lecture-panel.svelte';

	let token = getToken();
	let role = $state('');

	onMount(async () => {
		if (!token) {
			void goto('/signin');
			return;
		}
		try {
			const client = requireConvexClient();
			const me = (await client.query(api.staff.me, { token })) as { role: string } | null;
			if (!me) {
				endSession();
				void goto('/signin');
				return;
			}
			if (me.role !== 'lecturer') {
				void goto('/home');
				return;
			}
			role = me.role;
		} catch {
			// Network trouble — keep the token and let the sign-in page re-check.
			void goto('/signin');
		}
	});

	const tabs = [
		{ key: 'setup', label: 'Classes & semesters' },
		{ key: 'people', label: 'Students' },
		{ key: 'subjects', label: 'Subjects' },
		{ key: 'timetable', label: 'Timetable' },
		{ key: 'lectures', label: 'Lectures' }
	] as const;
</script>

<div class="flex flex-col gap-4">
	<div class="flex items-center gap-3">
		<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
		<div>
			<h1 class="text-xl font-bold text-lams-navy">Lecturer console</h1>
			<p class="text-xs text-muted-foreground">
				Set up semesters, classes and subjects, add students, then start lectures and review records.
			</p>
		</div>
	</div>

	{#if role === 'lecturer'}
		<Tabs.Root value="setup">
			<Tabs.List class="h-auto flex-wrap justify-start gap-1">
				{#each tabs as t (t.key)}
					<Tabs.Trigger value={t.key} class="flex-1 sm:flex-none">{t.label}</Tabs.Trigger>
				{/each}
			</Tabs.List>
			{#each tabs as t (t.key)}
				<Tabs.Content value={t.key} class="mt-4">
					{#if t.key === 'setup'}
						<SetupPanel />
					{:else if t.key === 'people'}
						<PeoplePanel />
					{:else if t.key === 'subjects'}
						<SubjectsPanel />
					{:else if t.key === 'timetable'}
						<TimetablePanel />
					{:else}
						<LecturePanel />
					{/if}
				</Tabs.Content>
			{/each}
		</Tabs.Root>
	{/if}
</div>
