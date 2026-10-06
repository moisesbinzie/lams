<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { CalendarDays } from '@lucide/svelte';
	import type { TimetableWeekly, TimetableMakeup } from '$lib/lams/types';
	import { reportError } from '$lib/lams/notify.svelte';
	import StudentNav from '$lib/components/lams/student-nav.svelte';

	const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
			loading = false;
		}
	});

	const byDay = $derived(
		DAYS.map((day, index) => ({ day, index, items: weekly.filter((w) => w.dayOfWeek === index) })).filter(
			(d) => d.items.length > 0
		)
	);
</script>

	<StudentNav />
	<div class="text-center">
		<h1 class="text-2xl font-bold text-lams-navy">My timetable</h1>
		<p class="text-sm text-muted-foreground">The classes you are enrolled in, and when they meet.</p>
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
					You have not joined any subjects yet. Once you do, your lectures will show up here.
				</p>
				<Button href="/courses">Join a subject</Button>
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="grid gap-3 md:grid-cols-2">
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
											<p class="text-sm font-semibold">{item.subjectCode}</p>
											<p class="text-xs text-muted-foreground">{item.subjectTitle}</p>
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
								<Table.Head>Subject</Table.Head>
								<Table.Head>Time</Table.Head>
								<Table.Head>Room</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each makeups as m (m.meetingId)}
								<Table.Row>
									<Table.Cell class="text-xs">{m.date}</Table.Cell>
									<Table.Cell class="text-xs">
										<strong>{m.subjectCode}</strong>
										<span class="block text-muted-foreground">{m.subjectTitle}</span>
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
			<Button variant="outline" href="/courses">Change my subjects</Button>
		</div>
	{/if}