<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { BookMarked, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import ProgramPicker from './program-picker.svelte';
	import ProgramBoard from './program-board.svelte';
	import CoursePlacementDialog from './course-placement-dialog.svelte';
	import CourseBulkPlaceDialog from './course-bulk-place-dialog.svelte';
	import OfferingRosterDialog from './offering-roster-dialog.svelte';
	import type {
		Course,
		ProgramCoursePlacement,
		ProgramRow,
		Semester,
		StaffRow
	} from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';
	import { sessionMe } from '$lib/lams/session.svelte';

	/**
	 * The Programs tab: the whole course structure, in one place.
	 *
	 * Two levels, deliberately kept apart:
	 *   - the catalogue, which is global — a course code exists once and can be
	 *     placed in any number of programs;
	 *   - the placements, which are per program, per year, per semester.
	 *
	 * The panel owns both because they are one job: you cannot meaningfully add
	 * a course without putting it somewhere, and a program with no courses is
	 * an empty shell. Lecturers get the same view, read-only.
	 */
	let token = getToken();
	let programs = $state<ProgramRow[]>([]);
	let semesters = $state<Semester[]>([]);
	let courses = $state<Course[]>([]);
	let lecturers = $state<StaffRow[]>([]);
	let placements = $state<ProgramCoursePlacement[]>([]);

	let programId = $state('');
	let loading = $state(true);
	let boardLoading = $state(false);
	let busy = $state(false);
	let activeYear = $state<number | null>(null);

	// New / edit program.
	let editorOpen = $state(false);
	let editorId = $state('');
	let editorName = $state('');
	let editorYears = $state('4');

	// Place a course.
	let placeOpen = $state(false);
	let placeYear = $state(1);
	let placeSemesterId = $state('');

	// Place one course into several programs.
	let bulkOpen = $state(false);

	// Catalogue search.
	let catalogueSearch = $state('');

	// Remove states.
	let removeProgramOpen = $state(false);
	let removeCourseTarget = $state<Course | null>(null);

	let catalogueCode = $state('');
	let catalogueTitle = $state('');
	let catalogueHours = $state('3');
	let catalogueBusy = $state(false);

	const me = $derived(sessionMe());
	const isAdmin = $derived(me?.kind === 'staff' && (me.isAdmin === true || me.role === 'admin'));
	const selected = $derived(programs.find((p) => p._id === programId) ?? null);

	/** Codes already placed in the selected program, for the repeat warning. */
	const placedCourseIds = $derived(
		placements.map((p) => p.courseId).filter((id): id is string => Boolean(id))
	);
	/** Catalogue courses no program teaches. Surfaced so they get placed or dropped. */
	const orphans = $derived(isAdmin ? courses.filter((c) => (c.placementCount ?? 0) === 0) : []);

	/** Catalogue filtered by the search box. */
	const catalogueFiltered = $derived.by(() => {
		const q = catalogueSearch.trim().toLowerCase();
		if (!q) return courses;
		return courses.filter(
			(c) =>
				c.code.toLowerCase().includes(q) ||
				c.title.toLowerCase().includes(q) ||
				(c.programNames ?? []).some((n) => n.toLowerCase().includes(q))
		);
	});

	async function loadStatics() {
		const client = requireConvexClient();
		const base = [
			client.query(api.academics.listPrograms, { token }),
			client.query(api.academics.listSemesters, { token }),
			client.query(api.academics.listCourses, { token }),
			client.query(api.academics.getActiveYear, { token })
		];
		const res = (await Promise.all(
			isAdmin ? [...base, client.query(api.staff.listStaff, { token })] : base
		)) as [ProgramRow[], Semester[], Course[], { activeYear: number | null }, StaffRow[]?];
		programs = res[0];
		semesters = res[1];
		courses = res[2];
		activeYear = res[3]?.activeYear ?? null;
		if (isAdmin && res[4]) lecturers = (res[4] as StaffRow[]).filter((s) => !s.isAdmin);
		if (!programId || !programs.some((p) => p._id === programId)) {
			programId = programs[0]?._id ?? '';
		}
	}

	async function loadPlacements() {
		if (!programId) {
			placements = [];
			return;
		}
		boardLoading = true;
		try {
			const client = requireConvexClient();
			placements = (await client.query(api.academics.listProgramBoard, {
				token,
				programId: programId as never
			})) as unknown as ProgramCoursePlacement[];
		} catch (err) {
			reportError(err, 'Could not load the courses in that program.');
			placements = [];
		} finally {
			boardLoading = false;
		}
	}

	/**
	 * Everything that can change a placement, in one call.
	 *
	 * Re-reading the program list as well as the board is not laziness: placing
	 * or removing a course changes each program's `courseCount`, and a stale
	 * count next to a freshly moved course reads as a bug.
	 */
	async function refresh({ statics = false } = {}) {
		if (statics) await loadStatics();
		await loadPlacements();
	}

	onMount(async () => {
		if (!token) {
			loading = false;
			return;
		}
		try {
			await loadStatics();
			await loadPlacements();
		} catch (err) {
			reportError(err, 'Could not load the programs.');
		} finally {
			loading = false;
		}
	});

	function openNewProgram() {
		editorId = '';
		editorName = '';
		editorYears = '4';
		editorOpen = true;
	}

	function openEditProgram(p: ProgramRow) {
		editorId = p._id;
		editorName = p.name;
		editorYears = String(p.durationYears);
		editorOpen = true;
	}

	async function saveProgram(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			if (editorId) {
				await client.mutation(api.academics.updateProgram, {
					token,
					id: editorId as never,
					name: editorName.trim(),
					durationYears: Number(editorYears)
				});
			} else {
				await client.mutation(api.academics.createProgram, {
					token,
					name: editorName.trim(),
					durationYears: Number(editorYears)
				});
			}
			editorOpen = false;
			await refresh({ statics: true });
			reportSuccess(editorId ? 'Program updated.' : `${editorName.trim()} created. Place its courses next.`, 7000);
		} catch (err) {
			reportError(err, 'Could not save the program.');
		} finally {
			busy = false;
		}
	}

	async function removeProgram() {
		if (!selected) return;
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeProgram, { token, id: selected._id as never });
			programId = '';
			await refresh({ statics: true });
			reportSuccess('Program removed. Students are kept and can join another program.');
		} catch (err) {
			reportError(err, 'Could not remove the program.');
		} finally {
			busy = false;
			removeProgramOpen = false;
		}
	}

	function openPlace(year = 1, semesterId = '') {
		placeYear = year || 1;
		placeSemesterId = semesterId;
		placeOpen = true;
	}

	async function createCatalogueCourse(e: SubmitEvent) {
		e.preventDefault();
		catalogueBusy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.createCourse, {
				token,
				code: catalogueCode.trim(),
				title: catalogueTitle.trim(),
				hoursPerWeek: Number(catalogueHours) || undefined
			});
			catalogueCode = '';
			catalogueTitle = '';
			await refresh({ statics: true });
			reportSuccess('Course saved to the catalogue. Place it in a program above.', 7000);
		} catch (err) {
			reportError(err, 'Could not save the course.');
		} finally {
			catalogueBusy = false;
		}
	}

	async function removeCatalogueCourse() {
		if (!removeCourseTarget) return;
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeCourse, {
				token,
				id: removeCourseTarget._id as never
			});
			await refresh({ statics: true });
			reportSuccess(`${removeCourseTarget.code} removed from the catalogue.`);
		} catch (err) {
			// The server refuses while any program still takes it.
			reportError(err, 'Could not remove the course.');
		} finally {
			busy = false;
			removeCourseTarget = null;
		}
	}

	async function toggleOpen(placement: ProgramCoursePlacement, open: boolean) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.setOfferingOpen, {
				token,
				id: placement._id as never,
				open
			});
			await loadPlacements();
			reportSuccess(
				open
					? `Students in this program can now join ${placement.courseCode} themselves.`
					: `Self-enrolment closed for ${placement.courseCode}.`
			);
		} catch (err) {
			reportError(err, 'Could not change enrolment.');
		}
	}

	async function setLecturers(placement: ProgramCoursePlacement, ids: string[]) {
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.setOfferingLecturers, {
				token,
				id: placement._id as never,
				lecturerIds: ids as never[]
			});
			await loadPlacements();
			reportSuccess(
				ids.length > 0
					? `${placement.courseCode} is now taught by ${ids.length} lecturer${ids.length === 1 ? '' : 's'}.`
					: `${placement.courseCode} is unassigned — nobody sees it yet.`
			);
		} catch (err) {
			reportError(err, 'Could not assign those lecturers.');
		} finally {
			busy = false;
		}
	}

	async function removePlacement(placement: ProgramCoursePlacement) {
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeOffering, { token, id: placement._id as never });
			await refresh({ statics: true });
			reportSuccess(`${placement.courseCode} removed from ${selected?.name ?? 'the program'}.`);
		} catch (err) {
			reportError(err, 'Could not remove that placement.');
		} finally {
			busy = false;
		}
	}

	function onRoster(placement: ProgramCoursePlacement) {
		rosterFor = placement;
		rosterOpen = true;
	}

	// Roster dialog state lives here so the board stays a presentation component.
	let rosterFor = $state<ProgramCoursePlacement | null>(null);
	let rosterOpen = $state(false);
</script>

<div class="flex flex-col gap-4">
	{#if loading}
		<div class="flex flex-col gap-2">
			<div class="h-8 w-64 animate-pulse rounded-md bg-muted"></div>
			<div class="h-40 animate-pulse rounded-md bg-muted"></div>
		</div>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title>Programs ({programs.length})</Card.Title>
				<Card.Description>
					{isAdmin
						? 'A program is a course of study, e.g. “BSc Computer Science”, running several years. Pick one to see and change the courses it teaches.'
						: 'The programs you teach in. Only an admin can create or edit them.'}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<div class="flex flex-wrap items-end justify-between gap-3">
					<div class="min-w-0 flex-1">
						<ProgramPicker
							{programs}
							bind:programId
							showCounts="courses"
							emptyHint={isAdmin
								? 'No programs yet — create the first one.'
								: 'No programs assigned to you yet.'}
						/>
					</div>
					{#if isAdmin}
						<div class="flex flex-wrap gap-2">
							<Button size="sm" onclick={openNewProgram}>
								<Plus class="size-3.5" aria-hidden="true" /> New program
							</Button>
							{#if selected}
								<Button size="sm" variant="outline" onclick={() => openEditProgram(selected)}>
									<Pencil class="size-3.5" aria-hidden="true" /> Edit
								</Button>
								<Button
									size="sm"
									variant="ghost"
									class="text-red-700"
									disabled={busy}
									onclick={() => (removeProgramOpen = true)}
								>
									<Trash2 class="size-3.5" aria-hidden="true" /> Remove
								</Button>
							{/if}
						</div>
					{/if}
				</div>

				{#if orphans.length > 0}
					<div class="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
						<strong>{orphans.length} course{orphans.length === 1 ? '' : 's'}</strong>
						in the catalogue {orphans.length === 1 ? 'is' : 'are'} in no program at all:
						{orphans.map((c) => c.code).join(', ')}. Place {orphans.length === 1 ? 'it' : 'them'},
						or remove {orphans.length === 1 ? 'it' : 'them'} so the catalogue stays honest.
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		{#if selected}
			<ProgramBoard
				program={selected}
				{semesters}
				{placements}
				{lecturers}
				{isAdmin}
				anchorYear={activeYear}
				loading={boardLoading}
				{busy}
				onadd={openPlace}
				ontoggleopen={toggleOpen}
				onsetlecturers={setLecturers}
				onroster={onRoster}
				onremove={removePlacement}
			/>
		{:else if programs.length === 0}
			<p class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
				{isAdmin
					? 'No programs yet. Create one above — it is the second step, after the academic year.'
					: 'Nothing assigned to you yet. Ask an admin to assign your courses.'}
			</p>
		{/if}

		{#if isAdmin}
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex flex-wrap items-center gap-2">
						<BookMarked class="size-4 text-lams-navy" aria-hidden="true" />
						Course catalogue ({courses.length})
						<Button size="sm" variant="outline" class="ml-auto" onclick={() => (bulkOpen = true)}>
							<Plus class="size-3.5" aria-hidden="true" /> Place in several programs
						</Button>
					</Card.Title>
					<Card.Description>
						Every course code the university teaches, saved once. Placing one in a program does
						not copy it — the same course can sit in many programs, and in more than one year of
						this one if it is repeated.
					</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-col gap-3">
					<form class="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto]" onsubmit={createCatalogueCourse}>
						<div class="flex flex-col gap-1">
							<Label for="cat-code">Code</Label>
							<Input id="cat-code" bind:value={catalogueCode} placeholder="e.g. BIT 221" required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="cat-title">Title</Label>
							<Input id="cat-title" bind:value={catalogueTitle} placeholder="e.g. Database Systems" required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="cat-hours">Hours/week</Label>
							<Input id="cat-hours" type="number" min="1" max="20" bind:value={catalogueHours} />
						</div>
						<div class="flex items-end">
							<Button type="submit" disabled={catalogueBusy}>
								{catalogueBusy ? 'Saving…' : 'Add course'}
							</Button>
						</div>
					</form>

					{#if courses.length > 4}
						<Input
							bind:value={catalogueSearch}
							placeholder="Search code, title or program"
							aria-label="Search the catalogue"
						/>
					{/if}

					{#if courses.length === 0}
						<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
							The catalogue is empty. Add the first course above, or create one while placing
							it in a program.
						</p>
					{:else if catalogueFiltered.length === 0}
						<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
							No course matches that search.
						</p>
					{:else}
						<ul class="flex flex-wrap gap-2">
							{#each catalogueFiltered as c (c._id)}
								<li
									class="flex items-center gap-2 rounded-full border border-border bg-muted/40 py-1 pr-1 pl-3 text-xs"
								>
									<span class="font-mono font-medium">{c.code}</span>
									<span class="text-muted-foreground">{c.title}</span>
									{#if (c.placementCount ?? 0) === 0}
										<Badge class="bg-amber-600 text-white">Not placed</Badge>
									{:else}
										<Badge variant="outline">
											{c.placementCount} placement{c.placementCount === 1 ? '' : 's'}
										</Badge>
										{#if (c.programNames ?? []).length > 0}
											<span
												class="max-w-44 truncate text-muted-foreground"
												title={(c.programNames ?? []).join(', ')}
											>
												in {(c.programNames ?? []).join(', ')}{
													(c.placementCount ?? 0) > (c.programNames ?? []).length ? '…' : ''
												}
											</span>
										{/if}
									{/if}
									<Button
										variant="ghost"
										size="icon-sm"
										class="text-red-700"
										aria-label={`Remove ${c.code} from the catalogue`}
										disabled={busy}
										onclick={() => (removeCourseTarget = c)}
									>
										<Trash2 class="size-3.5" aria-hidden="true" />
									</Button>
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>

<Dialog.Root bind:open={editorOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{editorId ? 'Edit program' : 'New program'}</Dialog.Title>
			<Dialog.Description>
				{editorId
					? 'Changing the number of years adds or hides year tabs. Courses already placed are not moved.'
					: 'A program of study and how many years it runs. Courses are placed after this.'}
			</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-3" onsubmit={saveProgram}>
			<div class="flex flex-col gap-1">
				<Label for="prog-name">Name</Label>
				<Input id="prog-name" bind:value={editorName} placeholder="e.g. BSc Computer Science" required />
			</div>
			<div class="flex flex-col gap-1">
				<Label for="prog-years">Years</Label>
				<Input id="prog-years" type="number" min="1" max="10" bind:value={editorYears} required />
			</div>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="outline" onclick={() => (editorOpen = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>

<CoursePlacementDialog
	bind:open={placeOpen}
	{token}
	program={selected}
	{semesters}
	{courses}
	{lecturers}
	defaultYear={placeYear}
	defaultSemesterId={placeSemesterId}
	placedKeys={placedCourseIds}
	onplaced={async () => refresh({ statics: true })}
/>

<CourseBulkPlaceDialog
	bind:open={bulkOpen}
	{token}
	{courses}
	{programs}
	{semesters}
	{lecturers}
	onplaced={async () => refresh({ statics: true })}
/>

<OfferingRosterDialog
	bind:open={rosterOpen}
	offering={rosterFor}
	{programs}
	{token}
	onchanged={async () => loadPlacements()}
/>

<AlertDialog.Root bind:open={removeProgramOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove {selected?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				This only works while the program has no courses placed in it. Students are kept — they
				can be moved to another program from the Students tab.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={removeProgram}>Remove</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root open={Boolean(removeCourseTarget)} onOpenChange={(o) => !o && (removeCourseTarget = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove {removeCourseTarget?.code} from the catalogue?</AlertDialog.Title>
			<AlertDialog.Description>
				The catalogue is the one place a code lives. This only works while no program is taking
				it — remove its placements first. Lecture records are kept as history.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={removeCatalogueCourse}>Remove</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
