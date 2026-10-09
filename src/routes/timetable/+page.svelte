<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { CalendarDays } from '@lucide/svelte';
	import type { TimetableWeekly, TimetableMakeup } from '$lib/lams/types';
	import { reportError } from '$lib/lams/notify.svelte';
	import StudentNav from '$lib/components/lams/student-nav.svelte';
	import LecturerNav from '$lib/components/lams/lecturer-nav.svelte';
	import TimetablePanel from '$lib/components/lams/timetable-panel.svelte';

	const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	/**
	 * Shared timetable page: students see their own week (built from their
	 * enrolments), while lecturers get the full editable week grid scoped to
	 * the courses assigned to them — the same panel the setup console uses,
	 * so there is exactly one editor and its scoping rules stay in one place.
	 */
	let viewerKind = $state<'staff' | 'person' | ''>('');
	let weekly = $state<TimetableWeekly[]>([]);
	let makeups = $state<TimetableMakeup[]>([]);
	let loading = $state(true);

	onMount(async () => {
		const token = getToken();
		if (!token) {
			void goto('/signin');
			return;
		}
		try {
			const client = requireConvexClient();
			const me = (await client.query(api.staff.me, { token })) as {
				kind: string;
				role: string;
			} | null;
			if (!me) {
				endSession();
				void goto('/signin');
				return;
			}
			if (me.kind === 'staff') {
				viewerKind = 'staff';
				loading = false;
				return;
			}
			viewerKind = 'person';
			const res = (await client.query(api.timetable.myTimetable, { token })) as {
				weekly: TimetableWeekly[];
				makeups: TimetableMakeup[];
			};
			weekly = res.weekly;
			makeups = res.makeups;
		} catch (err) {
			// Keep the token: a failed load is usually a network blip.
			reportError(err, 'Could not load your timetable.');
		} finally {
			if (viewerKind !== 'staff') loading = false;
		}
	});

	const byDay = $derived(
		DAYS.map((day, index) => ({ day, index, items: weekly.filter((w) => w.dayOfWeek === index) })).filter(
			(d) => d.items.length > 0
		)
	);
</script>

{#if viewerKind === 'staff'}
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 lg:max-w-5xl">
		<LecturerNav />
		<div class="flex items-center gap-3">
			<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
			<div>
				<h1 class="text-xl font-bold text-lams-navy">Timetable</h1>
				<p class="text-xs text-muted-foreground">
					When your courses meet. You only see the courses assigned to you — click an empty
					slot to add one, click a lecture to change it.
				</p>
			</div>
		</div>
		<TimetablePanel />
	</div>
{:else}
	<StudentNav />
	<div class="text-center">
		<h1 class="text-2xl font-bold text-lams-navy">My timetable</h1>
			<p class="text-sm text-muted-foreground">The courses you are enrolled in, and when they meet.</p>
	</div>

	{#if loading}
		<Card.Root aria-busy="true">
			<Card.Content class="pt-6">
				<p class="text-sm text-muted-foreground">Loading your timetable…</p>
			</Card.Content>
		</Card.Root>
	{:else if weekly.length === 0 && makeups.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center gap-3 py-8 text-center">
				<CalendarDays class="size-9 text-muted-foreground/60" aria-hidden="true" />
				<p class="text-sm font-medium">Your timetable is empty.</p>
				<p class="max-w-md text-sm text-muted-foreground">
					You have not joined any courses yet. Once you do, your lectures will show up here.
				</p>
				<Button href="/courses">Join a course</Button>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="grid gap-4 md:grid-cols-2">
			{#each byDay as group (group.day)}
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">{group.day}</Card.Title>
					</Card.Header>
					<Card.Content>
						<ul class="flex flex-col gap-2">
							{#each group.items as item (item.meetingId)}
								<li class="rounded-md border border-border p-3">
									<div class="flex items-start justify-between gap-2">
										<div>
											<p class="text-sm font-semibold">{item.courseCode}</p>
											<p class="text-xs text-muted-foreground">{item.courseTitle}</p>
										</div>
										<span class="shrink-0 text-xs font-medium text-lams-navy">
											{item.startTime}–{item.endTime}
										</span>
									</div>
									{#if item.room}
										<p class="mt-1 text-xs text-muted-foreground">Room {item.room}</p>
									{/if}
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/each}
		</div>

		{#if makeups.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">Extra lectures (make-ups)</Card.Title>
					<Card.Description>
						One-off lectures arranged outside your normal weekly timetable.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<!--
						The scroll box matters: without it this table's nowrap
						cells are wider than a phone column and would push the
						whole page sideways instead of scrolling in place.
					-->
					<div class="overflow-x-auto rounded-md border">
						<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Date</Table.Head>
									<Table.Head>Course</Table.Head>
								<Table.Head>Time</Table.Head>
								<Table.Head>Room</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each makeups as m (m.meetingId)}
								<Table.Row>
									<Table.Cell class="text-xs">{m.date}</Table.Cell>
									<Table.Cell class="text-xs">
										<strong>{m.courseCode}</strong>
										<span class="block text-muted-foreground">{m.courseTitle}</span>
									</Table.Cell>
									<Table.Cell class="text-xs">{m.startTime}–{m.endTime}</Table.Cell>
									<Table.Cell class="text-xs">{m.room || '—'}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
						</Table.Root>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}

		<div class="flex justify-center">
			<Button variant="outline" href="/courses">Change my courses</Button>
		</div>
	{/if}
{/if}
