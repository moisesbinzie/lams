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
	import * as Select from '$lib/components/ui/select';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';
	import { toast } from 'svelte-sonner';
	import type { ProgramRow, Meeting, Offering } from '$lib/lams/types';

	const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	let token = getToken();
	let programs = $state<ProgramRow[]>([]);
	let offerings = $state<Offering[]>([]);
	let programId = $state('');
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
			const me = (await client.query(api.staff.me, { token })) as {
				kind: string;
				role: string;
			} | null;
			if (!me || me.kind !== 'staff') {
				if (!me) endSession();
				else toast.error('Only lecturers can edit timetables.');
				return;
			}
			if (me.role !== 'lecturer' && me.role !== 'admin') {
				toast.error('Only lecturers can edit timetables.');
				return;
			}
			programs = (await client.query(api.academics.listPrograms, { token })) as unknown as ProgramRow[];
			if (!programId && programs.length > 0) programId = programs[0]._id;
			await loadOfferings();
		} catch (err) {
			// Keep the token: a failed load is usually a network blip.
			reportError(err, 'Could not load.');
		}
	});

	async function loadOfferings() {
		if (!programId) return;
		try {
			const client = requireConvexClient();
			offerings = (await client.query(api.academics.listOfferings, {
				token,
				programId: programId as never
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
		if (!programId) return;
		try {
			const client = requireConvexClient();
			clashes = (await client.query(api.timetable.findClashes, {
				token,
				programId: programId as never,
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
		if (programId) void loadOfferings();
	});
	$effect(() => {
		if (offeringId) void loadMeetings();
	});
</script>

<div class="flex flex-col gap-4">
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
				<Label for="cls">Program</Label>
				<Select.Root
					type="single"
					value={programId}
					onValueChange={(v) => {
						programId = v ?? '';
						// Clear the subject immediately: the offerings list reloads
						// async, and until it does the old subject id matches no
						// item — the trigger would show the raw id instead.
						offeringId = '';
						meetings = [];
					}}
				>
					<Select.Trigger id="cls" class="w-full">
						<Select.Value placeholder="Choose a program" />
					</Select.Trigger>
					<Select.Content>
						<Select.Group>
							{#each programs as c (c._id)}
								<Select.Item value={c._id} label={c.name}>{c.name}</Select.Item>
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="off">Course</Label>
				<Select.Root type="single" value={offeringId} onValueChange={(v) => (offeringId = v ?? '')}>
					<Select.Trigger id="off" class="w-full">
						<Select.Value placeholder="Choose a course" />
					</Select.Trigger>
					<Select.Content>
						<Select.Group>
							{#each offerings as o (o._id)}
								<Select.Item value={o._id} label={`${o.courseCode} — ${o.courseTitle}`}>
									{o.courseCode} — {o.courseTitle}
								</Select.Item>
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
			</div>
	</div>

	{#if !offerings.length}
		<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
			Offer this program a course first, then set when it meets.
		</p>
	{:else if selected}
		<Card.Root>
			<Card.Header>
				<Card.Title>{selected.courseCode} — {selected.courseTitle}</Card.Title>
				<Card.Description>
					When this course meets each week. Students see these times on their own timetable.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<form class="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]" onsubmit={addWeekly}>
					<div class="flex flex-col gap-1">
						<Label for="dow">Day</Label>
						<Select.Root
							type="single"
							value={dayOfWeek}
							onValueChange={(v) => {
								dayOfWeek = v ?? '';
								void checkClashes();
							}}
						>
							<Select.Trigger id="dow" class="w-full">
								<Select.Value placeholder="Choose a day" />
							</Select.Trigger>
							<Select.Content>
								<Select.Group>
									{#each DAYS as d, i (d)}
										<Select.Item value={String(i)}>{d}</Select.Item>
									{/each}
								</Select.Group>
							</Select.Content>
						</Select.Root>
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
							<DatePicker id="md" label="Date" bind:value={makeupDate} />
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
								<Label for="mnote">Note (optional)</Label>
								<Input
									id="mnote"
									class="mt-1 w-full"
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