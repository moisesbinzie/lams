<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import LecturerNav from '$lib/components/lams/lecturer-nav.svelte';
	import AdminAccountsPanel from '$lib/components/lams/admin-accounts-panel.svelte';
	import type { ProgramRow, Offering, StaffRow } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	interface LecturerStat {
		_id: string;
		assignmentCount: number;
		lecturesTotal: number;
		lecturesOpen: number;
		lecturesClosed: number;
		lastLectureAt: number | null;
	}

	interface RenameStatus {
		classes: number;
		subjects: number;
		programs: number;
		courses: number;
		offeringsTotal: number;
		offeringsMigrated: number;
		offeringsTruncated: boolean;
		membersOld: number;
		membersNew: number;
		membersTruncated: boolean;
		repsOld: number;
		repsNew: number;
		needsMigration: boolean;
	}

	/**
	 * The admin console: overview + accounts only.
	 *
	 * The teaching structure lives where it is built — the setup console at
	 * `/manage` (academic year, programs, students, timetable). This page
	 * links there instead of embedding it, so there is one write path.
	 *
	 * Overview also carries the setup checklist. Its job is to answer "what do I
	 * do next", which is the only question a first-time admin has.
	 */
	let token = getToken();
	let me = $state<{ username?: string; fullName?: string } | null>(null);
	let staff = $state<StaffRow[]>([]);
	let offerings = $state<Offering[]>([]);
	let programs = $state<ProgramRow[]>([]);
	let lectureStats = $state<LecturerStat[]>([]);
	let rename = $state<RenameStatus | null>(null);
	let migrating = $state(false);
	let migrationStep = $state('');
	let loading = $state(true);
	let tab = $state('overview');

	const activeLecturers = $derived(staff.filter((s) => !s.isAdmin && s.active));
	const unassigned = $derived(offerings.filter((o) => (o.lecturerIds ?? []).length === 0));
	const assignedCount = $derived(offerings.length - unassigned.length);

	async function loadOverview() {
		const client = requireConvexClient();
		const [staffRows, offeringRows, programRows, statRows, renameRows] = (await Promise.all([
			client.query(api.staff.listStaff, { token }),
			client.query(api.academics.listOfferings, { token }),
			client.query(api.academics.listPrograms, { token }),
			client.query(api.staff.lecturerStats, { token }),
			client.query(api.migrations.renameStatus, { token })
		])) as [StaffRow[], Offering[], ProgramRow[], LecturerStat[], RenameStatus];
		staff = staffRows;
		offerings = offeringRows;
		programs = programRows;
		lectureStats = statRows;
		rename = renameRows;
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
			void goto(profile.role === 'lecturer' ? '/lectures' : '/home');
			return;
		}
			me = profile;
			await loadOverview();
		} catch (err) {
			reportError(err, 'Could not load the admin console.');
		} finally {
			loading = false;
		}
	});

	async function runMigration() {
		if (
			!confirm(
				'Copy Classes/Subjects into Programs/Courses now? Back up the deployment first (Convex dashboard → Export). Nothing old is deleted.'
			)
		)
			return;
		migrating = true;
		try {
			const client = requireConvexClient();
			let phase: string | undefined = undefined;
			let cursor: string | null = null;
			for (let i = 0; i < 500; i += 1) {
				const res = (await client.mutation(api.migrations.migrateToProgramsAndCourses, {
					token,
					...(phase ? { phase } : {}),
					...(cursor ? { cursor } : {})
				})) as { phase: string; next: { phase: string; cursor: string | null } | null };
				migrationStep = `Migrating ${res.phase}…`;
				if (!res.next || res.next.phase === 'done') break;
				phase = res.next.phase;
				cursor = res.next.cursor;
			}
			migrationStep = '';
			await loadOverview();
			reportSuccess(
				'Rename migration finished. Check the counts: programs/courses should mirror the old data.',
				9000
			);
		} catch (err) {
			reportError(err, 'Migration stopped with an error. It is safe to run again — finished phases are skipped.');
		} finally {
			migrating = false;
		}
	}

	const tabs = [
		{ key: 'overview', label: 'Overview' },
		{ key: 'accounts', label: 'Accounts & activity' }
	] as const;
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 lg:max-w-5xl">
	<div class="flex items-center gap-3">
		<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
		<div>
			<h1 class="flex flex-wrap items-center gap-2 text-xl font-bold text-lams-navy">
				Admin console <Badge class="bg-amber-600 text-white">Admin account</Badge>
			</h1>
			<p class="text-xs text-muted-foreground">
				Signed in as <strong>{me?.username ?? '…'}</strong>. Lecturer accounts live here; the
				academic year, programs, students and timetables are built in the setup console.
			</p>
		</div>
	</div>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else}
		<LecturerNav />

		<Tabs.Root bind:value={tab}>
			<Tabs.List class="h-auto flex-wrap justify-start gap-1">
				{#each tabs as t (t.key)}
					<Tabs.Trigger value={t.key} class="flex-1 sm:flex-none">{t.label}</Tabs.Trigger>
				{/each}
			</Tabs.List>

			<Tabs.Content value="overview" class="mt-4 flex flex-col gap-4">
				<section aria-label="Overview" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
					<Card.Root>
						<Card.Content class="pt-5 text-center">
							<p class="text-3xl font-extrabold text-lams-navy">{activeLecturers.length}</p>
							<p class="text-xs text-muted-foreground">
								Active lecturer{activeLecturers.length === 1 ? '' : 's'}
								{#if staff.filter((s) => !s.isAdmin).length !== activeLecturers.length}
									({staff.filter((s) => !s.isAdmin).length} total)
								{/if}
							</p>
						</Card.Content>
					</Card.Root>
					<Card.Root>
						<Card.Content class="pt-5 text-center">
							<p class="text-3xl font-extrabold text-lams-navy">{programs.length}</p>
							<p class="text-xs text-muted-foreground">Program{programs.length === 1 ? '' : 's'}</p>
						</Card.Content>
					</Card.Root>
					<Card.Root>
						<Card.Content class="pt-5 text-center">
							<p class="text-3xl font-extrabold text-lams-navy">{offerings.length}</p>
							<p class="text-xs text-muted-foreground">
								Course placement{offerings.length === 1 ? '' : 's'}
							</p>
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
								{:else}
									Placements assigned
								{/if}
							</p>
						</Card.Content>
					</Card.Root>
				</section>

				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">Getting started</Card.Title>
						<Card.Description>
							Four steps, in order. Each one unlocks the next, and each has its own tab in the
							setup console.
						</Card.Description>
					</Card.Header>
					<Card.Content>
						<ol class="flex flex-col gap-3">
							<li class="flex flex-wrap items-center justify-between gap-2 text-sm">
								<span>
									<strong>1. Create lecturer accounts</strong>
									<span class="block text-xs text-muted-foreground">
										Usernames plus a generated temporary password — in this console.
									</span>
								</span>
								<span class="flex items-center gap-2">
									{#if activeLecturers.length > 0}
										<Badge class="bg-emerald-600 text-white">Done</Badge>
									{:else}
										<Badge variant="secondary">To do</Badge>
									{/if}
									<Button size="sm" variant="outline" onclick={() => (tab = 'accounts')}>
										Open accounts
									</Button>
								</span>
							</li>
							<li class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
								<span>
									<strong>2. Create the academic year</strong>
									<span class="block text-xs text-muted-foreground">
										Semester 1 and 2, with their dates. Everything else hangs off a semester.
									</span>
								</span>
							<span class="flex items-center gap-2">
								<Button size="sm" variant="outline" href="/manage?tab=academic-year">Open Set up</Button>
							</span>
							</li>
							<li class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
								<span>
									<strong>3. Register programs and place their courses</strong>
									<span class="block text-xs text-muted-foreground">
										Each course placed by year of study and semester. One course can serve
										several programs.
									</span>
								</span>
							<span class="flex items-center gap-2">
								{#if offerings.length > 0}
									<Badge class="bg-emerald-600 text-white">Done</Badge>
								{:else}
									<Badge variant="secondary">To do</Badge>
								{/if}
								<Button size="sm" variant="outline" href="/manage?tab=programs">
									Review in Set up
								</Button>
							</span>
							</li>
							<li class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
								<span>
									<strong>4. Assign every placement a lecturer</strong>
									<span class="block text-xs text-muted-foreground">
										A lecturer only sees their own courses.
									</span>
								</span>
								<span class="flex items-center gap-2">
									{#if offerings.length > 0 && unassigned.length === 0}
										<Badge class="bg-emerald-600 text-white">Done</Badge>
									{:else}
										<Badge variant="secondary">To do</Badge>
									{/if}
								</span>
							</li>
						</ol>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">Students and timetables</Card.Title>
						<Card.Description>
							Once courses are placed, register the roll and give each student their courses, then
							timetable the week — both in the setup console.
						</Card.Description>
					</Card.Header>
				<Card.Content class="flex flex-wrap gap-2">
					<Button href="/manage?tab=students" variant="outline">Register students</Button>
					<Button href="/manage?tab=timetable" variant="outline">Build the timetable</Button>
				</Card.Content>
				</Card.Root>

				{#if rename?.needsMigration}
					<Card.Root class="border-amber-300">
						<Card.Header>
							<Card.Title>Finish the Program/Course move</Card.Title>
							<Card.Description>
								Old data found: {rename.classes} classes and {rename.subjects} subjects, with
								{rename.programs} programs and {rename.courses} courses so far. Run the migration
								to copy everything across — old tables stay untouched as a backup.
							</Card.Description>
						</Card.Header>
						<Card.Content class="flex flex-col gap-3">
							<p class="text-xs text-muted-foreground">
								Back up first (Convex dashboard → Export). The move runs in small pages and skips
								anything already copied, so it is safe to re-run. Afterwards the old tables can be
								dropped in a follow-up schema edit.
							</p>
							<div>
								<Button disabled={migrating} onclick={runMigration}>
									{migrating ? migrationStep || 'Migrating…' : 'Run migration'}
								</Button>
							</div>
						</Card.Content>
					</Card.Root>
				{/if}
			</Tabs.Content>

		<Tabs.Content value="accounts" class="mt-4">
			{#if token}
				<AdminAccountsPanel {token} bind:staff {lectureStats} />
			{/if}
		</Tabs.Content>
	</Tabs.Root>
	{/if}
</div>
