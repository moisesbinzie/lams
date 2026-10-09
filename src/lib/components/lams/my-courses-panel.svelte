<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { BookOpen, Plus } from '@lucide/svelte';
	import type { MyEnrolment, OpenCourse } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	/**
	 * The student's own courses: what they are taking, grouped by program, and
	 * what is open to join.
	 *
	 * Replaces the shared admin/lecturer/student tree, which had to serve three
	 * audiences and therefore served none of them well. A student only ever
	 * needs one question answered, so this is a list, not a tree.
	 */
	let { token }: { token: string } = $props();

	let enrolments = $state<MyEnrolment[]>([]);
	let openCourses = $state<OpenCourse[]>([]);
	let loading = $state(true);
	let busyId = $state('');

	const byProgram = $derived.by(() => {
		const map = new Map<string, MyEnrolment[]>();
		for (const e of enrolments) {
			const key = e.programName || 'My courses';
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(e);
		}
		for (const list of map.values()) list.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
		return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	});

	const joinable = $derived(
		openCourses
			.filter((o) => !o.alreadyEnrolled)
			.sort(
				(a, b) =>
					a.programName.localeCompare(b.programName) || a.courseCode.localeCompare(b.courseCode)
			)
	);

	async function load() {
		try {
			const client = requireConvexClient();
			const [mine, open] = (await Promise.all([
				client.query(api.enrolments.listMine, { token }),
				client.query(api.enrolments.listOpenForStudent, { token })
			])) as [MyEnrolment[], OpenCourse[]];
			enrolments = mine;
			openCourses = open;
		} catch (err) {
			reportError(err, 'Could not load your courses.');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});

	async function join(offeringId: string) {
		busyId = offeringId;
		try {
			const client = requireConvexClient();
			await client.mutation(api.enrolments.enrolSelf, { token, offeringId: offeringId as never });
			await load();
			reportSuccess('Enrolled. Your timetable builds itself from here.');
		} catch (err) {
			reportError(err, 'Could not join that course.');
		} finally {
			busyId = '';
		}
	}

	async function drop(offeringId: string, label: string) {
		if (!confirm(`Leave ${label}? You can rejoin while enrolment stays open.`)) return;
		busyId = offeringId;
		try {
			const client = requireConvexClient();
			await client.mutation(api.enrolments.dropSelf, { token, offeringId: offeringId as never });
			await load();
			reportSuccess('Left that course.');
		} catch (err) {
			reportError(err, 'Could not leave that course.');
		} finally {
			busyId = '';
		}
	}
</script>

{#if loading}
	<div class="h-24 animate-pulse rounded-md bg-muted"></div>
{:else if enrolments.length === 0 && joinable.length === 0}
	<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
		No courses yet. Ask your program rep or lecturer to add you to your program.
	</p>
{:else}
	<div class="flex flex-col gap-4">
		{#each byProgram as [programName, list] (programName)}
			<div class="rounded-lg border border-border">
				<div class="flex flex-wrap items-center gap-2 px-4 py-3">
					<BookOpen class="size-4 text-lams-navy" aria-hidden="true" />
					<span class="text-sm font-bold text-lams-navy">{programName}</span>
					<Badge variant="outline">
						{list.length} course{list.length === 1 ? '' : 's'}
					</Badge>
				</div>
				<ul class="flex flex-col divide-y divide-border border-t border-border px-4">
					{#each list as e (e._id)}
						<li class="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<p class="text-sm font-semibold">{e.courseCode} — {e.courseTitle}</p>
								<p class="text-xs text-muted-foreground">
									{e.semesterName} · {e.meetings.length} meeting time{e.meetings.length === 1 ? '' : 's'} · joined
									{e.addedBy === 'self' ? 'by you' : `by ${e.addedBy}`}
								</p>
							</div>
							<Button
								variant="ghost"
								size="sm"
								class="self-start text-red-700 sm:self-center"
								disabled={busyId === e.offeringId}
								onclick={() => drop(e.offeringId, e.courseCode)}
							>
								Leave
							</Button>
						</li>
					{/each}
				</ul>
			</div>
		{/each}

		{#if joinable.length > 0}
			<div class="rounded-lg border border-lams-green/40">
				<div class="flex flex-wrap items-center gap-2 px-4 pt-3">
					<Plus class="size-4 text-lams-green" aria-hidden="true" />
					<p class="text-sm font-bold text-lams-navy">Open to join</p>
				</div>
				<p class="px-4 text-xs text-muted-foreground">
					Your lecturer opened these for self-enrolment — including repeats from earlier semesters.
				</p>
				<ul class="flex flex-col divide-y divide-border px-4 pb-2">
					{#each joinable as o (o._id)}
						<li class="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<p class="text-sm font-semibold">{o.courseCode} — {o.courseTitle}</p>
								<p class="text-xs text-muted-foreground">
									{o.programName} · {o.semesterName}{o.hoursPerWeek ? ` · ${o.hoursPerWeek} h/week` : ''}
								</p>
							</div>
							<Button
								variant="secondary"
								size="sm"
								class="self-start sm:self-center"
								disabled={busyId === o._id}
								onclick={() => join(o._id)}
							>
								{busyId === o._id ? 'Joining…' : 'Join'}
							</Button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}
