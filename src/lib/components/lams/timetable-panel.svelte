<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';
	import { toast } from 'svelte-sonner';
	import type { ClassRow, Meeting, Offering } from '$lib/lams/types';

	const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	let token = getToken();
	let classes = $state<ClassRow[]>([]);
	let offerings = $state<Offering[]>([]);
	let classId = $state('');
	let offeringId = $state('');
	let meetings = $state<Meeting[]>([]);
	let clashes = $state<string[]>([]);

	let dayOfWeek = $state('1');
	let startTime = $state('09:00');
	let endTime = $state('10:00');
	let room = $state('');
	let makeupDate = $state('');
	let makeupNote = $state('');
	let showMakeup = $state(false);

	const selected = $derived(offerings.find((o) => o._id === offeringId) ?? null);
	const weekly = $derived(meetings.filter((m) => m.kind === 'weekly'));
	const makeups = $derived(meetings.filter((m) => m.kind === 'makeup'));

	onMount(async () => {
		if (!token) return;
		try {
			const client = requireConvexClient();
			const me = (await client.query(api.staff.me, { token })) as { role: string } | null;
			if (!me) {
				endSession();
				return;
			}
			if (me.role !== 'lecturer') {
				toast.error('Only lecturers can edit timetables.');
				return;
			}
			classes = (await client.query(api.academics.listClasses, { token })) as unknown as ClassRow[];
			if (!classId && classes.length > 0) classId = classes[0]._id;
			await loadOfferings();
		} catch (err) {
			// Keep the token: a failed load is usually a network blip.
			reportError(err, 'Could not load.');
		}
	});

	async function loadOfferings() {
		if (!classId) return;
		try {
			const client = requireConvexClient();
			offerings = (await client.query(api.academics.listOfferings, {
				token,
				classId: classId as never
			})) as unknown as Offering[];
			if (!offeringId || !offerings.some((o) => o._id === offeringId)) {
				offeringId = offerings[0]?._id ?? '';
			}
			await loadMeetings();
		} catch (err) {
			reportError(err, 'Could not load subjects.');
		}
	}

	async function loadMeetings() {
		if (!offeringId) {
			meetings = [];
			return;
		}
		try {
			const client = requireConvexClient();
			meetings = (await client.query(api.timetable.listForOffering, {
				token,
				offeringId: offeringId as never
			})) as unknown as Meeting[];
		} catch (err) {
			reportError(err, 'Could not load the timetable.');
		}
	}

	async function checkClashes() {
		clashes = [];
		if (!classId) return;
		try {
			const client = requireConvexClient();
			clashes = (await client.query(api.timetable.findClashes, {
				token,
				classId: classId as never,
				dayOfWeek: Number(dayOfWeek),
				startTime,
				endTime
			})) as unknown as string[];
		} catch {
			// A failed warning check should not block saving.
		}
	}

	async function addWeekly(e: SubmitEvent) {
		e.preventDefault();
		try {
			const client = requireConvexClient();
			await client.mutation(api.timetable.createWeekly, {
				token,
				offeringId: offeringId as never,
				dayOfWeek: Number(dayOfWeek),
				startTime,
				endTime,
				...(room.trim() ? { room: room.trim() } : {})
			});
			room = '';
			clashes = [];
			await loadMeetings();
			reportSuccess('Weekly slot added.');
		} catch (err) {
			reportError(err, 'Could not add that slot.');
		}
	}

	async function addMakeup(e: SubmitEvent) {
		e.preventDefault();
		try {
			const client = requireConvexClient();
			await client.mutation(api.timetable.createMakeup, {
				token,
				offeringId: offeringId as never,
				date: makeupDate,
				startTime,
				endTime,
				...(room.trim() ? { room: room.trim() } : {}),
				...(makeupNote.trim() ? { note: makeupNote.trim() } : {})
			});
			makeupDate = '';
			makeupNote = '';
			room = '';
			showMakeup = false;
			await loadMeetings();
			reportSuccess('Extra lecture added. It appears on students’ timetables as a make-up.');
		} catch (err) {
			reportError(err, 'Could not add that lecture.');
		}
	}

	async function removeMeeting(id: string) {
		if (!confirm('Remove this slot?')) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.timetable.removeMeeting, { token, id: id as never });
			await loadMeetings();
		} catch (err) {
			reportError(err, 'Could not remove it.');
		}
	}

	$effect(() => {
		if (classId) void loadOfferings();
	});
	$effect(() => {
		if (offeringId) void loadMeetings();
	});
</script>

<div class="flex flex-col gap-4">
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<Label for="cls">Class</Label>
			<select
				id="cls"
				class="w-full rounded-md border border-input bg-background p-2 text-sm"
				bind:value={classId}
			>
				{#each classes as c (c._id)}
					<option value={c._id}>{c.name}</option>
				{/each}
			</select>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="off">Subject</Label>
			<select
				id="off"
				class="w-full rounded-md border border-input bg-background p-2 text-sm"
				bind:value={offeringId}
			>
				{#each offerings as o (o._id)}
					<option value={o._id}>{o.subjectCode} — {o.subjectTitle}</option>
				{/each}
			</select>
		</div>
	</div>

	{#if !offerings.length}
		<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
			Offer this class a subject first, then set when it meets.
		</p>
	{:else if selected}
		<Card.Root>
			<Card.Header>
				<Card.Title>{selected.subjectCode} — {selected.subjectTitle}</Card.Title>
				<Card.Description>
					When this subject meets each week. Students see these times on their own timetable.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<form class="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]" onsubmit={addWeekly}>
					<div class="flex flex-col gap-1">
						<Label for="dow">Day</Label>
						<select
							id="dow"
							class="w-full rounded-md border border-input bg-background p-2 text-sm"
							bind:value={dayOfWeek}
							onchange={checkClashes}
						>
							{#each DAYS as d, i (d)}
								<option value={String(i)}>{d}</option>
							{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1">
						<Label for="st">From</Label>
						<Input id="st" type="time" bind:value={startTime} onchange={checkClashes} required />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="et">To</Label>
						<Input id="et" type="time" bind:value={endTime} onchange={checkClashes} required />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="rm">Room</Label>
						<Input id="rm" bind:value={room} placeholder="e.g. 12" />
					</div>
					<div class="flex items-end">
						<Button type="submit">Add slot</Button>
					</div>
				</form>

				{#if clashes.length > 0}
					<p class="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
						Warning — this time overlaps: {clashes.join(', ')}. Save it anyway if that is intended.
					</p>
				{/if}

				{#if weekly.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						No weekly times yet. Add one above.
					</p>
				{:else}
					<ul class="flex flex-col divide-y divide-border">
						{#each weekly as m (m._id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
								<span>
									<strong>{m.dayName}</strong>
									{m.startTime}–{m.endTime}
									{#if m.room}· Room {m.room}{/if}
								</span>
								<Button variant="ghost" size="sm" onclick={() => removeMeeting(m._id)}>Remove</Button>
							</li>
						{/each}
					</ul>
				{/if}

				<div class="border-t border-border pt-4">
					<div class="flex items-center justify-between gap-2">
						<div>
							<p class="text-sm font-medium">Extra lecture (make-up)</p>
							<p class="text-xs text-muted-foreground">
								A one-off lecture outside the weekly timetable, for a cancelled class.
							</p>
						</div>
						<Button size="sm" variant={showMakeup ? 'outline' : 'secondary'} onclick={() => (showMakeup = !showMakeup)}>
							{showMakeup ? 'Close' : 'Add extra lecture'}
						</Button>
					</div>
					{#if showMakeup}
						<form class="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]" onsubmit={addMakeup}>
							<div class="flex flex-col gap-1">
								<Label for="md">Date</Label>
								<Input id="md" type="date" bind:value={makeupDate} required />
							</div>
							<div class="flex flex-col gap-1">
								<Label for="mst">From</Label>
								<Input id="mst" type="time" bind:value={startTime} required />
							</div>
							<div class="flex flex-col gap-1">
								<Label for="met">To</Label>
								<Input id="met" type="time" bind:value={endTime} required />
							</div>
							<div class="flex flex-col gap-1">
								<Label for="mrm">Room</Label>
								<Input id="mrm" bind:value={room} />
							</div>
							<div class="flex items-end">
								<Button type="submit">Add</Button>
							</div>
							<div class="sm:col-span-5">
								<label class="text-xs font-medium" for="mnote">Note (optional)</label>
								<input
									id="mnote"
									class="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm"
									bind:value={makeupNote}
									placeholder="e.g. Covers the lecture missed on the 12th"
								/>
							</div>
						</form>
					{/if}
					{#if makeups.length > 0}
						<ul class="mt-3 flex flex-col divide-y divide-border">
							{#each makeups as m (m._id)}
								<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
									<span>
										<strong>{m.date}</strong>
										{m.startTime}–{m.endTime}
										{#if m.room}· Room {m.room}{/if}
										{#if m.note}<span class="text-muted-foreground">· {m.note}</span>{/if}
									</span>
									<Button variant="ghost" size="sm" onclick={() => removeMeeting(m._id)}>Remove</Button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>