<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { TimetableGridCourse, TimetableSlot } from '$lib/lams/types';
	import { clashingMeetingIds, toMinutes, toClock, SLOT_MINUTES } from '$lib/lams/grid';
	import { TriangleAlert } from '@lucide/svelte';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	/**
	 * Add or change one lecture slot.
	 *
	 * One dialog serves both kinds of meeting, because the difference between a
	 * weekly slot and a one-off make-up is a single field — and pretending they
	 * are separate screens is how a cancelled lecture ends up in the weekly grid.
	 */
	let {
		open = $bindable(false),
		token,
		courses,
		/** The week as it stands, so a new slot can warn about a real overlap. */
		slots,
		/** null — the dialog is adding. Otherwise it is editing this meeting. */
		editing = null,
		defaultDay = 1,
		defaultStart = '09:00',
		oneOff = false,
		defaultOfferingId = '',
		onsaved
	}: {
		open?: boolean;
		token: string;
		courses: TimetableGridCourse[];
		slots: TimetableSlot[];
		editing?: TimetableSlot | null;
		defaultDay?: number;
		defaultStart?: string;
		/** Prefer the one-off (make-up) form — used by the "Extra lecture" button. */
		oneOff?: boolean;
		defaultOfferingId?: string;
		onsaved?: () => void | Promise<void>;
	} = $props();

	const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	let offeringId = $state('');
	let kind = $state<'weekly' | 'makeup'>('weekly');
	let dayOfWeek = $state('1');
	let date = $state('');
	let startTime = $state('09:00');
	let endTime = $state('10:00');
	let room = $state('');
	let note = $state('');
	let busy = $state(false);

	const isEditing = $derived(Boolean(editing));

	/**
	 * Clashes the *pending* slot would create, ignoring the one being edited.
	 * Computed rather than queried: the week is already on screen, and asking
	 * the server for something the dialog can see would just be slower.
	 */
	const pendingClashes = $derived.by(() => {
		const candidate = {
			meetingId: '__pending__',
			dayOfWeek: kind === 'weekly' ? Number(dayOfWeek) : -1,
			startTime,
			endTime
		};
		if (kind !== 'weekly') return [];
		if (toMinutes(startTime) === null || toMinutes(endTime) === null) return [];
		if ((toMinutes(endTime) ?? 0) <= (toMinutes(startTime) ?? 0)) return [];
		const others = slots.filter((s) => s.meetingId !== editing?.meetingId);
		const clashing = clashingMeetingIds([...others, candidate]);
		if (!clashing.has('__pending__')) return [];
		return others.filter((s) => clashing.has(s.meetingId));
	});

	// Every open starts from the place that was clicked, never from last time.
	$effect(() => {
		if (!open) return;
		if (editing) {
			offeringId = editing.offeringId;
			kind = 'weekly';
			dayOfWeek = String(editing.dayOfWeek);
			startTime = editing.startTime;
			endTime = editing.endTime;
			room = editing.room;
			date = '';
			note = '';
			return;
		}
		kind = oneOff ? 'makeup' : 'weekly';
		dayOfWeek = String(defaultDay);
		startTime = defaultStart;
		// A lecture defaults to an hour, snapped to the quarter hour.
		endTime = toClock((toMinutes(defaultStart) ?? 9 * 60) + 60);
		room = '';
		note = '';
		date = '';
		offeringId = defaultOfferingId || courses[0]?.offeringId || '';
	});

	/**
	 * Room double-bookings for the pending slot: same room, same day,
	 * overlapping time, a different meeting. Empty rooms never clash.
	 */
	const pendingRoomClashes = $derived.by(() => {
		if (kind !== 'weekly') return [];
		const target = room.trim().toLowerCase();
		if (!target) return [];
		if (toMinutes(startTime) === null || toMinutes(endTime) === null) return [];
		if ((toMinutes(endTime) ?? 0) <= (toMinutes(startTime) ?? 0)) return [];
		return slots.filter(
			(s) =>
				s.meetingId !== editing?.meetingId &&
				s.dayOfWeek === Number(dayOfWeek) &&
				(s.room ?? '').trim().toLowerCase() === target &&
				startTime < s.endTime &&
				s.startTime < endTime
		);
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!offeringId) {
			reportError(new Error('No course.'), 'Choose the course this lecture belongs to.');
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			if (editing) {
				await client.mutation(api.timetable.updateMeeting, {
					token,
					id: editing.meetingId as never,
					startTime,
					endTime,
					room,
					...(kind === 'weekly' ? { dayOfWeek: Number(dayOfWeek) } : { date })
				});
			} else if (kind === 'weekly') {
				await client.mutation(api.timetable.createWeekly, {
					token,
					offeringId: offeringId as never,
					dayOfWeek: Number(dayOfWeek),
					startTime,
					endTime,
					room
				});
			} else {
				await client.mutation(api.timetable.createMakeup, {
					token,
					offeringId: offeringId as never,
					date,
					startTime,
					endTime,
					room,
					note
				});
			}
			open = false;
			await onsaved?.();
			reportSuccess(
				editing
					? 'Slot updated.'
					: kind === 'weekly'
						? 'Weekly slot added to the timetable.'
						: 'Extra lecture added — students see it as a make-up.'
			);
		} catch (err) {
			reportError(err, 'Could not save that slot.');
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!editing) return;
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.timetable.removeMeeting, { token, id: editing.meetingId as never });
			open = false;
			await onsaved?.();
			reportSuccess('Slot removed from the timetable.');
		} catch (err) {
			// The server refuses when attendance already exists for this slot.
			reportError(err, 'Could not remove that slot.');
		} finally {
			busy = false;
		}
	}

	function nudgeEnd(minutes: number) {
		const start = toMinutes(startTime) ?? 9 * 60;
		endTime = toClock(start + minutes);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>
				{isEditing
					? `Edit ${editing?.courseCode} on ${DAYS[editing?.dayOfWeek ?? 0]}`
					: oneOff
						? 'Add an extra lecture'
						: 'Add a lecture to the week'}
			</Dialog.Title>
			<Dialog.Description>
				{#if isEditing}
					Change when it runs or where it meets. Lecture records already taken against this slot
					are kept.
				{:else if oneOff}
					A one-off lecture outside the weekly timetable, for a class that was cancelled.
				{:else}
					Weekly slots repeat every week with the same time and room. Use “Extra lecture” for a
					one-off.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<form class="flex flex-col gap-3" onsubmit={save}>
			{#if !isEditing}
				<div class="flex gap-1 rounded-full border border-border p-1" role="tablist" aria-label="Kind of lecture">
					<Button
						type="button"
						variant={kind === 'weekly' ? 'secondary' : 'ghost'}
						size="sm"
						class="flex-1 rounded-full"
						role="tab"
						aria-selected={kind === 'weekly'}
						onclick={() => (kind = 'weekly')}
					>
						Weekly
					</Button>
					<Button
						type="button"
						variant={kind === 'makeup' ? 'secondary' : 'ghost'}
						size="sm"
						class="flex-1 rounded-full"
						role="tab"
						aria-selected={kind === 'makeup'}
						onclick={() => (kind = 'makeup')}
					>
						One-off (make-up)
					</Button>
				</div>
			{/if}

			<div class="flex flex-col gap-1.5">
				<Label for="ts-course">Course</Label>
				<Select.Root
					type="single"
					value={offeringId}
					onValueChange={(v) => (offeringId = v ?? '')}
					items={courses.map((c) => ({
						value: c.offeringId,
						label: `${c.courseCode} — ${c.courseTitle} (Year ${c.yearOfStudy ?? '—'})`
					}))}
				>
					<Select.Trigger id="ts-course" class="w-full" disabled={isEditing}>
						<Select.Value placeholder="Choose a course" />
					</Select.Trigger>
					<Select.Content>
						<Select.Group>
							{#each courses as c (c.offeringId)}
								<Select.Item
									value={c.offeringId}
									label={`${c.courseCode} — ${c.courseTitle} (Year ${c.yearOfStudy ?? '—'})`}
								>
									{c.courseCode} — {c.courseTitle}
									<span class="text-muted-foreground">Year {c.yearOfStudy ?? '—'}</span>
								</Select.Item>
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
				{#if isEditing}
					<p class="text-xs text-muted-foreground">
						The course is fixed once a slot exists — remove this slot and add a new one to move it.
					</p>
				{/if}
			</div>

			<div class="grid gap-3 sm:grid-cols-3">
				{#if kind === 'weekly'}
					<div class="flex flex-col gap-1.5">
						<Label for="ts-day">Day</Label>
						<Select.Root
							type="single"
							value={dayOfWeek}
							onValueChange={(v) => (dayOfWeek = v ?? '1')}
							items={DAYS.map((d, i) => ({ value: String(i), label: d }))}
						>
							<Select.Trigger id="ts-day" class="w-full">
								<Select.Value placeholder="Choose a day" />
							</Select.Trigger>
							<Select.Content>
								<Select.Group>
									{#each DAYS as d, i (d)}
										<Select.Item value={String(i)} label={d}>{d}</Select.Item>
									{/each}
								</Select.Group>
							</Select.Content>
						</Select.Root>
					</div>
				{:else}
					<div class="flex flex-col gap-1.5">
						<Label for="ts-date">Date</Label>
						<Input id="ts-date" type="date" bind:value={date} required />
					</div>
				{/if}
				<div class="flex flex-col gap-1.5">
					<Label for="ts-start">From</Label>
					<Input id="ts-start" type="time" step={SLOT_MINUTES * 60} bind:value={startTime} required />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="ts-end">To</Label>
					<Input id="ts-end" type="time" step={SLOT_MINUTES * 60} bind:value={endTime} required />
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<span class="text-xs text-muted-foreground">Length</span>
				{#each [60, 90, 120] as minutes (minutes)}
					<Button type="button" variant="outline" size="sm" onclick={() => nudgeEnd(minutes)}>
						{minutes / 60} h
					</Button>
				{/each}
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="ts-room">Room</Label>
				<Input id="ts-room" bind:value={room} placeholder="e.g. 12 or Lab 3" />
			</div>

			{#if kind === 'makeup'}
				<div class="flex flex-col gap-1.5">
					<Label for="ts-note">Note (optional)</Label>
					<Textarea
						id="ts-note"
						class="min-h-16"
						bind:value={note}
						placeholder="e.g. Covers the lecture missed on the 12th"
					/>
				</div>
			{/if}

			{#if pendingClashes.length > 0}
				<p class="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
					<TriangleAlert class="mr-1 inline size-3" aria-hidden="true" />
					This overlaps {pendingClashes.length} other slot{pendingClashes.length === 1 ? '' : 's'} on
					{DAYS[kind === 'weekly' ? Number(dayOfWeek) : 0]}:
					{pendingClashes.map((s) => `${s.courseCode} ${s.startTime}–${s.endTime}`).join(', ')}. Save
					it anyway if that is intended.
				</p>
			{/if}

			{#if pendingRoomClashes.length > 0}
			<p class="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
				<TriangleAlert class="mr-1 inline size-3" aria-hidden="true" />
				Room “{room.trim()}” is already booked then:
				{pendingRoomClashes.map((s) => `${s.courseCode} ${s.startTime}–${s.endTime}`).join(', ')}.
				Save it anyway only if the room holds both.
			</p>
		{/if}

		<div class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
				{#if isEditing}
					<AlertDialog.Root>
						<AlertDialog.Trigger class="text-sm text-red-700 hover:underline" type="button">
							Remove this slot
						</AlertDialog.Trigger>
						<AlertDialog.Content>
							<AlertDialog.Header>
								<AlertDialog.Title>Remove {editing?.courseCode} at {editing?.startTime}?</AlertDialog.Title>
								<AlertDialog.Description>
									This only works while no attendance has been taken for the slot — those
									records are kept as history.
								</AlertDialog.Description>
							</AlertDialog.Header>
							<AlertDialog.Footer>
								<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
								<AlertDialog.Action onclick={remove}>Remove</AlertDialog.Action>
							</AlertDialog.Footer>
						</AlertDialog.Content>
					</AlertDialog.Root>
				{:else}
					<span></span>
				{/if}
				<div class="flex gap-2">
					<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
					<Button type="submit" disabled={busy || !offeringId || (kind === 'makeup' && !date)}>
						{busy ? 'Saving…' : isEditing ? 'Save slot' : 'Add slot'}
					</Button>
				</div>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
