<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import { Badge } from '$lib/components/ui/badge';
	import * as Tabs from '$lib/components/ui/tabs';
	import LecturerNav from '$lib/components/lams/lecturer-nav.svelte';
	import AcademicYearPanel from '$lib/components/lams/academic-year-panel.svelte';
	import ProgramsPanel from '$lib/components/lams/programs-panel.svelte';
	import StudentsPanel from '$lib/components/lams/students-panel.svelte';
	import TimetablePanel from '$lib/components/lams/timetable-panel.svelte';

	/**
	 * The setup console: four tabs that follow the structure itself, in the
	 * order it has to be built.
	 *
	 *   1. Academic year  — years and their semesters. Nothing else can exist first.
	 *   2. Programs       — programs, and the courses placed in them per year and
	 *                       semester. The course catalogue lives here too, because
	 *                       adding a course and placing it are one decision.
	 *   3. Students       — the roll, and the courses each student studies.
	 *   4. Timetable      — when those courses meet, as a week.
	 *
	 * Admins only. Lecturers used to share these screens, but their job now
	 * lives in the main tabs (Take attendance, Lectures, Records, Timetable,
	 * Settings) — a lecturer who lands here is sent to `/lectures`.
	 */
	let token = getToken();
	let role = $state('');
	let isAdmin = $state(false);
	let tab = $state('academic-year');

	const VALID_TABS = new Set(['academic-year', 'programs', 'students', 'timetable']);

	onMount(async () => {
		const requested = page.url.searchParams.get('tab');
		if (requested && VALID_TABS.has(requested)) tab = requested;
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
			if (!isAdmin) {
				void goto('/lectures');
				return;
			}
		} catch {
			// Network trouble — keep the token and let the sign-in page re-check.
			void goto('/signin');
		}
	});

	const adminTabs = [
		{ key: 'academic-year', label: 'Academic year' },
		{ key: 'programs', label: 'Programs' },
		{ key: 'students', label: 'Students' },
		{ key: 'timetable', label: 'Timetable' }
	] as const;

	const tabs = adminTabs;
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 lg:max-w-5xl">
	<div class="flex items-center gap-3">
		<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
		<div>
			<h1 class="flex flex-wrap items-center gap-2 text-xl font-bold text-lams-navy">
				Setup console
				<Badge class="bg-amber-600 text-white">Admin account</Badge>
			</h1>
			<p class="text-xs text-muted-foreground">
				Work left to right: create the academic year, place courses in your programs, register
				students and give them their courses, then timetable the week. Lecturer accounts and
				their assignments live in the admin console.
			</p>
		</div>
	</div>

	{#if isAdmin}
		<LecturerNav />
		<Tabs.Root bind:value={tab}>
			<Tabs.List class="h-auto flex-wrap justify-start gap-1">
				{#each tabs as t (t.key)}
					<Tabs.Trigger value={t.key} class="flex-1 sm:flex-none">{t.label}</Tabs.Trigger>
				{/each}
			</Tabs.List>
			{#each tabs as t (t.key)}
				<Tabs.Content value={t.key} class="mt-4">
					{#if t.key === 'academic-year'}
						<AcademicYearPanel />
					{:else if t.key === 'programs'}
						<ProgramsPanel />
					{:else if t.key === 'students'}
						<StudentsPanel />
					{:else}
						<TimetablePanel />
					{/if}
				</Tabs.Content>
			{/each}
		</Tabs.Root>
	{/if}
</div>
