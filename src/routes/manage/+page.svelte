<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Tabs from '$lib/components/ui/tabs';
	import LecturerNav from '$lib/components/lams/lecturer-nav.svelte';
	import SetupPanel from '$lib/components/lams/setup-panel.svelte';
	import PeoplePanel from '$lib/components/lams/people-panel.svelte';
	import CoursesPanel from '$lib/components/lams/subjects-panel.svelte';
	import TimetablePanel from '$lib/components/lams/timetable-panel.svelte';
	import LecturePanel from '$lib/components/lams/lecture-panel.svelte';

	let token = getToken();
	let role = $state('');
	let isAdmin = $state(false);

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
		} catch {
			// Network trouble — keep the token and let the sign-in page re-check.
			void goto('/signin');
		}
	});

	const allTabs = [
		{ key: 'setup', label: 'Programs & semesters' },
		{ key: 'people', label: 'Students' },
		{ key: 'courses', label: 'Courses' },
		{ key: 'timetable', label: 'Timetable' },
		{ key: 'lectures', label: 'Lectures' }
	] as const;

	/**
	 * Admins organise structure here; running lectures is a lecturer job, so
	 * the Lectures tab is not shown to admins. Lecturers keep all five tabs.
	 */
	const tabs = $derived(isAdmin ? allTabs.filter((t) => t.key !== 'lectures') : allTabs);
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 lg:max-w-5xl">
	<div class="flex items-center gap-3">
		<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
		<div>
			<h1 class="flex flex-wrap items-center gap-2 text-xl font-bold text-lams-navy">
				{isAdmin ? 'Setup console' : 'Lecturer console'}
				{#if isAdmin}
					<Badge class="bg-amber-600 text-white">Admin account</Badge>
				{:else}
					<Badge class="bg-lams-navy text-white">Lecturer account</Badge>
				{/if}
			</h1>
			<p class="text-xs text-muted-foreground">
				{#if isAdmin}
					Organise semesters, programs, courses and timetables. Lecturer accounts and their
					assignments live in the admin console.
				{:else}
					Set up semesters, programs and courses, add students, then start lectures and review records.
				{/if}
			</p>
		</div>
	</div>

	{#if role === 'lecturer' || role === 'admin'}
		<LecturerNav />
		{#if !isAdmin}
			<p class="rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground" role="status">
				You only see the courses assigned to you. Ask the admin if a course is missing.
			</p>
		{/if}
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
					{:else if t.key === 'courses'}
						<CoursesPanel />
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
