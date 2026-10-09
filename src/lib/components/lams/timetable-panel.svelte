<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { CalendarPlus } from '@lucide/svelte';
	import ProgramPicker from './program-picker.svelte';
	import TimetableGrid from './timetable-grid.svelte';
	import TimetableSlotDialog from './timetable-slot-dialog.svelte';
	import * as Select from '$lib/components/ui/select';
	import type { ProgramRow, Semester, TimetableGrid as GridData, TimetableSlot } from '$lib/lams/types';
	import { reportError } from '$lib/lams/notify.svelte';

	/**
	 * The Timetable tab.
	 *
	 * Scope first — a semester, a program, and optionally one year of study —
	 * then the whole week as a spreadsheet. The grid is the primary control:
	 * clicking a cell is how a slot gets added, which is what makes this feel
	 * like a timetable rather than a form that happens to have a preview.
	 */
	let token = getToken();
	let programs = $state<ProgramRow[]>([]);
	let semesters = $state<Semester[]>([]);
	let programId = $state('');
	let semesterId = $state('');
	/** '' means every year of study; a number narrows the view (never the clash check). */
	let yearFilter = $state('');

	let data = $state<GridData | null>(null);
	let loading = $state(true);
	let gridLoading = $state(false);

	let dialogOpen = $state(false);
	let editing = $state<TimetableSlot | null>(null);
	let pickDay = $state(1);
	let pickStart = $state('09:00');
	let pickOffering = $state('');
	let oneOff = $state(false);

	const semestersOrdered = $derived(
		[...semesters].sort((a, b) => b.year - a.year || a.number - b.number)
	);
	const selectedProgram = $derived(programs.find((p) => p._id === programId) ?? null);
	const years = $derived(
		Array.from(
			{ length: Math.max(1, Math.min(10, selectedProgram?.durationYears ?? 1)) },
			(_, i) => i + 1
		)
	);
	/** Slots after the year filter — display only; the dialog warns against all of them. */
	const visibleSlots = $derived(
		(data?.slots ?? []).filter((s) => yearFilter === '' || (s.yearOfStudy ?? 0) === Number(yearFilter))
	);
	const visibleCourses = $derived(
		(data?.courses ?? []).filter(
			(c) => yearFilter === '' || (c.yearOfStudy ?? 0) === Number(yearFilter)
		)
	);

	/**
	 * Same room booked twice at overlapping times — a different mistake from a
	 * course clash (two courses can share students; two classes cannot share a
	 * room). Computed from what is already on screen.
	 */
	const roomClashes = $derived.by(() => {
		const slots = data?.slots ?? [];
		const found = new Set<string>();
		for (let i = 0; i < slots.length; i += 1) {
			const a = slots[i];
			const roomA = (a.room ?? '').trim().toLowerCase();
			if (!roomA) continue;
			for (let j = i + 1; j < slots.length; j += 1) {
				const b = slots[j];
				if (a.dayOfWeek !== b.dayOfWeek) continue;
				if ((b.room ?? '').trim().toLowerCase() !== roomA) continue;
				if (a.startTime < b.endTime && b.startTime < a.endTime) {
					found.add(a.meetingId);
					found.add(b.meetingId);
				}
			}
		}
		return found;
	});

	async function loadStatics() {
		const client = requireConvexClient();
		const [progs, sems, active] = (await Promise.all([
			client.query(api.academics.listPrograms, { token }),
			client.query(api.academics.listSemesters, { token }),
			client.query(api.academics.getActiveYear, { token })
		])) as [ProgramRow[], Semester[], { activeYear: number | null }];
		programs = progs;
		semesters = sems;
		if (!programId || !programs.some((p) => p._id === programId)) {
			programId = programs[0]?._id ?? '';
		}
		if (!semesterId || !semesters.some((s) => s._id === semesterId)) {
			// Prefer the active year's newest semester; fall back to newest overall.
			const inActive = active.activeYear
				? semestersOrdered.filter((s) => s.year === active.activeYear)
				: [];
			semesterId = (inActive[0] ?? semestersOrdered[0])?._id ?? '';
		}
	}

	async function loadGrid() {
		if (!programId || !semesterId) {
			data = null;
			return;
		}
		gridLoading = true;
		try {
			const client = requireConvexClient();
			data = (await client.query(api.timetable.gridForSemester, {
				token,
				programId: programId as never,
				semesterId: semesterId as never
			})) as unknown as GridData;
		} catch (err) {
			reportError(err, 'Could not load the timetable.');
			data = null;
		} finally {
			gridLoading = false;
		}
	}

	onMount(async () => {
		if (!token) {
			loading = false;
			return;
		}
		try {
			await loadStatics();
			await loadGrid();
		} catch (err) {
			reportError(err, 'Could not load the timetable.');
		} finally {
			loading = false;
		}
	});

	function addAt(day: number, startTime: string) {
		editing = null;
		oneOff = false;
		pickDay = day;
		pickStart = startTime;
		pickOffering = '';
		dialogOpen = true;
	}

	/** Start a slot for one unscheduled course from the legend below. */
	function scheduleCourse(offeringId: string) {
		editing = null;
		oneOff = false;
		pickDay = 1;
		pickStart = '09:00';
		pickOffering = offeringId;
		dialogOpen = true;
	}

	function addExtra() {
		editing = null;
		oneOff = true;
		pickDay = 1;
		pickStart = '09:00';
		pickOffering = '';
		dialogOpen = true;
	}

	function editSlot(slot: TimetableSlot) {
		editing = slot;
		oneOff = false;
		pickOffering = '';
		dialogOpen = true;
	}

	async function afterSave() {
		await loadGrid();
	}
</script>

<div class="flex flex-col gap-4">
	{#if loading}
		<div class="flex flex-col gap-2">
			<div class="h-8 w-64 animate-pulse rounded-md bg-muted"></div>
			<div class="h-64 animate-pulse rounded-md bg-muted"></div>
		</div>
	{:else if programs.length === 0}
		<p class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
			No programs yet. Create a program and place its courses first — a timetable is built from the
			courses a program takes.
		</p>
	{:else if semesters.length === 0}
		<p class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
			No semesters yet. Create the academic year first — a timetable belongs to one semester.
		</p>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex flex-wrap items-center gap-2">
					Weekly timetable
					{#if data}
						<Badge variant="secondary">{data.programName}</Badge>
						<Badge variant="outline">{data.semesterName} · {data.semesterYear}</Badge>
						{#if roomClashes.size > 0}
							<Badge class="bg-amber-600 text-white">
								{roomClashes.size} room clash{roomClashes.size === 1 ? '' : 'es'}
							</Badge>
						{/if}
					{/if}
				</Card.Title>
				<Card.Description>
					When each course of this program meets in this semester. Students see these times on
					their own timetable the moment they join a course.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<div class="grid gap-3 print:hidden sm:grid-cols-[1.4fr_1fr_0.8fr]">
					<ProgramPicker
						{programs}
						bind:programId
						variant="select"
						id="tt-program"
						emptyHint="No programs yet."
					/>
					<div class="flex flex-col gap-1.5">
						<span class="text-sm font-medium">Semester</span>
						<Select.Root
							type="single"
							value={semesterId}
							onValueChange={(v) => {
								semesterId = v ?? '';
								data = null;
							}}
						>
							<Select.Trigger id="tt-semester" class="w-full">
								<Select.Value placeholder="Choose a semester" />
							</Select.Trigger>
							<Select.Content>
								<Select.Group>
									{#each semestersOrdered as s (s._id)}
										<Select.Item value={s._id} label={`${s.name} · ${s.year}`}>
											{s.name} · {s.year}
										</Select.Item>
									{/each}
								</Select.Group>
							</Select.Content>
						</Select.Root>
					</div>
					<div class="flex flex-col gap-1.5">
						<span class="text-sm font-medium">Year of study</span>
						<Select.Root
							type="single"
							value={yearFilter || 'all'}
							onValueChange={(v) => (yearFilter = v === 'all' || !v ? '' : v)}
						>
							<Select.Trigger id="tt-year" class="w-full">
								<Select.Value placeholder="All years" />
							</Select.Trigger>
							<Select.Content>
								<Select.Group>
									<Select.Item value="all" label="All years">All years</Select.Item>
									{#each years as y (y)}
										<Select.Item value={String(y)} label={`Year ${y}`}>Year {y}</Select.Item>
									{/each}
								</Select.Group>
							</Select.Content>
						</Select.Root>
					</div>
				</div>

				{#if yearFilter !== ''}
					<p class="rounded-md border border-border bg-muted/50 p-2 text-xs text-muted-foreground">
						Showing Year {yearFilter} only. Overlaps are still judged against the whole semester —
						students repeat courses across years, so a clash outside this view is a real one.
					</p>
				{/if}

				{#if roomClashes.size > 0}
					<p class="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 print:hidden">
						{roomClashes.size} slot{roomClashes.size === 1 ? '' : 's'} share a room at overlapping
						times. Two classes cannot meet in one room — move one of them.
					</p>
				{/if}

				<div class="flex flex-wrap items-center gap-2 print:hidden">
					<Button size="sm" onclick={() => addAt(1, '09:00')}>
						<CalendarPlus class="size-3.5" aria-hidden="true" /> Add a weekly slot
					</Button>
					<Button size="sm" variant="outline" onclick={addExtra}>
						Add an extra lecture
					</Button>
					<Button size="sm" variant="ghost" onclick={() => window.print()}>Print week</Button>
				</div>

				{#if gridLoading}
					<div class="h-64 animate-pulse rounded-md bg-muted"></div>
				{:else if visibleCourses.length === 0}
					<p class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
						{yearFilter === ''
							? 'No courses are placed in this program for this semester. Place them on the Programs tab first.'
							: `No courses placed for Year ${yearFilter} in this semester.`}
					</p>
				{:else}
					<TimetableGrid slots={visibleSlots} onpick={addAt} onslot={editSlot} />
					{#if visibleSlots.length === 0}
						<p class="text-xs text-muted-foreground">
							{visibleCourses.length} course{visibleCourses.length === 1 ? '' : 's'} ready to
							schedule.
						</p>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>

		{#if data && data.courses.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">Courses in this semester ({data.courses.length})</Card.Title>
					<Card.Description>
						Every course the program takes this semester, with how many slots each one has on the
						grid above.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<ul class="flex flex-wrap gap-2">
						{#each data.courses as c (c.offeringId)}
							{@const count = data.slots.filter((s) => s.offeringId === c.offeringId).length}
							<li
								class="flex items-center gap-2 rounded-full border border-border bg-muted/40 py-1 pr-1 pl-3 text-xs"
							>
								<span class="font-mono font-medium">{c.courseCode}</span>
								<span class="text-muted-foreground">{c.courseTitle}</span>
								<Badge variant="outline">Year {c.yearOfStudy ?? '—'}</Badge>
								{#if count === 0}
									<Badge class="bg-amber-600 text-white">Unscheduled</Badge>
									<Button
										variant="ghost"
										size="sm"
										class="h-6 rounded-full px-2 text-[0.7rem]"
										onclick={() => scheduleCourse(c.offeringId)}
									>
										Schedule
									</Button>
								{:else}
									<Badge variant="secondary">{count} slot{count === 1 ? '' : 's'}</Badge>
								{/if}
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>

<TimetableSlotDialog
	bind:open={dialogOpen}
	{token}
	courses={data?.courses ?? []}
	slots={data?.slots ?? []}
	{editing}
	defaultDay={pickDay}
	defaultStart={pickStart}
	defaultOfferingId={pickOffering}
	oneOff={oneOff}
	onsaved={afterSave}
/>
