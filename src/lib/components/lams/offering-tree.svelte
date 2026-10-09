<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import type {
		MyEnrolment,
		Offering,
		OpenCourse,
		ProgramRow,
		Semester,
		StaffRow,
		Course
	} from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	/**
	 * The teaching structure as a tree: Semester → Year → Program → Course.
	 *
	 * `admin` manages everything inline: add programs, offer courses per year
	 * (by picker, or by dragging a catalogue course onto a program), assign
	 * any number of lecturers per course (checkboxes, or by dragging a
	 * lecturer chip onto a course), open enrolment and remove offerings.
	 * `mine` is the lecturer's read-only view of the same tree plus roster
	 * and enrolment switches. `student` is the student's own view: enrolled
	 * courses grouped by program, open courses to join, and drop where
	 * nothing is recorded.
	 */
	let {
		token,
		mode,
		onroster
	}: {
		token: string;
		mode: 'admin' | 'mine' | 'student';
		onroster?: (offering: Offering) => void;
	} = $props();

	const admin = $derived(mode === 'admin');
	const student = $derived(mode === 'student');

	// Staff tree data.
	let semesters = $state<Semester[]>([]);
	let programs = $state<ProgramRow[]>([]);
	let courses = $state<Course[]>([]);
	let offerings = $state<Offering[]>([]);
	let lecturers = $state<StaffRow[]>([]);
	// Student tree data.
	let enrolments = $state<MyEnrolment[]>([]);
	let openCourses = $state<OpenCourse[]>([]);

	let loading = $state(true);
	let busy = $state(false);
	let busyId = $state('');

	// Admin drafts, keyed by `${programId}:Y${year}:S${semesterId}`.
	let offerCourse = $state<Record<string, string>>({});
	let offerLecturers = $state<Record<string, string[]>>({});
	let showOffer = $state<Record<string, boolean>>({});
	let showProgram = $state(false);
	let showLecturers = $state(false);
	let newProgramName = $state('');
	let newProgramYears = $state('4');
	let dropTarget = $state<string | null>(null);
	let editingLecturers = $state<string | null>(null);
	let editLecturers = $state<string[]>([]);

	const NO_COURSE = 'no-course';

	const semestersOrdered = $derived(
		[...semesters].sort((a, b) => b.year - a.year || a.number - b.number)
	);
	const programsOrdered = $derived([...programs].sort((a, b) => a.name.localeCompare(b.name)));
	const activeLecturers = $derived(lecturers.filter((l) => l.active));

	function offeringsIn(programId: string, year: number, semesterId: string): Offering[] {
		return offerings
			.filter(
				(o) =>
					String(o.programId) === String(programId) &&
					o.yearOfStudy === year &&
					String(o.semesterId) === String(semesterId)
			)
			.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
	}

	/** Years to show inside one semester: everything up to the longest program (admin), or only years with offerings (lecturer). */
	function yearsInSemester(semesterId: string): number[] {
		const sid = String(semesterId);
		if (admin) {
			const maxDur = Math.min(
				10,
				Math.max(1, ...programs.map((p) => p.durationYears ?? 1))
			);
			return Array.from({ length: maxDur }, (_, i) => i + 1);
		}
		return [
			...new Set(
				offerings.filter((o) => String(o.semesterId) === sid).map((o) => o.yearOfStudy ?? 0)
			)
		]
			.filter((y) => y > 0)
			.sort((a, b) => a - b);
	}

	/** Programs with offerings in one semester (any year): for header counts. */
	function programsInSemester(semesterId: string): ProgramRow[] {
		const sid = String(semesterId);
		const ids = new Set(
			offerings.filter((o) => String(o.semesterId) === sid).map((o) => String(o.programId))
		);
		return programsOrdered.filter((p) => ids.has(String(p._id)));
	}

	/** Programs to show inside one semester year: all of them (admin), or only ones with offerings (lecturer). */
	function programsInSemesterYear(semesterId: string, year: number): ProgramRow[] {
		const sid = String(semesterId);
		if (admin) return programsOrdered;
		const ids = new Set(
			offerings
				.filter((o) => String(o.semesterId) === sid && o.yearOfStudy === year)
				.map((o) => String(o.programId))
		);
		return programsOrdered.filter((p) => ids.has(String(p._id)));
	}

	function lecturerNamesOf(o: Offering): string {
		if (o.lecturerNames && o.lecturerNames.length > 0) return o.lecturerNames.join(', ');
		return o.lecturerName ?? '';
	}

	/** Courses already offered to this program year in the chosen semester. */
	function offeredCourseIds(programId: string, year: number, semesterId: string): Set<string> {
		return new Set(
			offerings
				.filter(
					(o) =>
						String(o.programId) === String(programId) &&
						o.yearOfStudy === year &&
						String(o.semesterId) === String(semesterId)
				)
				.map((o) => String(o.courseId))
		);
	}

	const enrolledByProgram = $derived.by(() => {
		const m = new Map<string, MyEnrolment[]>();
		for (const e of enrolments) {
			const k = e.programName || 'My courses';
			if (!m.has(k)) m.set(k, []);
			m.get(k)!.push(e);
		}
		for (const list of m.values()) list.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
		return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	});

	const joinable = $derived(
		openCourses
			.filter((o) => !o.alreadyEnrolled)
			.sort((a, b) => a.programName.localeCompare(b.programName) || a.courseCode.localeCompare(b.courseCode))
	);

	async function load() {
		try {
			const client = requireConvexClient();
			if (student) {
				const [mine, open] = (await Promise.all([
					client.query(api.enrolments.listMine, { token }),
					client.query(api.enrolments.listOpenForStudent, { token })
				])) as [MyEnrolment[], OpenCourse[]];
				enrolments = mine;
				openCourses = open;
			} else {
				const base = [
					client.query(api.academics.listSemesters, { token }),
					client.query(api.academics.listPrograms, { token }),
					client.query(api.academics.listOfferings, { token }),
					client.query(api.academics.listCourses, { token })
				];
				const res = (await Promise.all(
					admin ? [...base, client.query(api.staff.listStaff, { token })] : base
				)) as [Semester[], ProgramRow[], Offering[], Course[], StaffRow[]?];
				semesters = res[0];
				programs = res[1];
				offerings = res[2];
				courses = res[3];
				if (admin && res[4]) lecturers = res[4].filter((s) => !s.isAdmin);
			}
		} catch (err) {
			reportError(err, 'Could not load the teaching structure.');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if (token) void load();
		else loading = false;
	});

	async function createProgram(e: SubmitEvent) {
		e.preventDefault();
		const name = newProgramName.trim();
		const years = Number(newProgramYears);
		if (!name) return;
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.createProgram, { token, name, durationYears: years });
			newProgramName = '';
			showProgram = false;
			await load();
			reportSuccess(`Program created with ${years} year(s). Offer its courses below.`, 7000);
		} catch (err) {
			reportError(err, 'Could not create the program.');
		} finally {
			busy = false;
		}
	}

	async function offer(programId: string, year: number, semesterId: string) {
		const key = `${programId}:Y${year}:S${semesterId}`;
		const courseId = offerCourse[key];
		if (!courseId) return;
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.createOffering, {
				token,
				courseId: courseId as never,
				programId: programId as never,
				semesterId: semesterId as never,
				yearOfStudy: year,
				lecturerIds: (offerLecturers[key] ?? []) as never[]
			});
			offerCourse[key] = '';
			offerLecturers[key] = [];
			showOffer[key] = false;
			await load();
			reportSuccess('Course offered. Set its timetable, then open enrolment or assign students.');
		} catch (err) {
			reportError(err, 'Could not offer that course.');
		} finally {
			busy = false;
		}
	}

	/** Drop target: prefill the program's offer form with the dragged course. */
	function dropCourse(e: DragEvent, programId: string, year: number, semesterId: string) {
		e.preventDefault();
		const courseId = e.dataTransfer?.getData('text/lams-course') ?? '';
		dropTarget = null;
		if (!courseId || !courses.some((c) => String(c._id) === courseId)) return;
		const key = `${programId}:Y${year}:S${semesterId}`;
		offerCourse[key] = courseId;
		showOffer[key] = true;
		document
			.getElementById(`offer-${programId}-${year}-${semesterId}`)
			?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	function toggleOfferLecturer(key: string, id: string) {
		const current = offerLecturers[key] ?? [];
		offerLecturers[key] = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
	}

	function toggleEditLecturer(id: string) {
		editLecturers = editLecturers.includes(id) ? editLecturers.filter((x) => x !== id) : [...editLecturers, id];
	}

	async function saveLecturers(offeringId: string) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.setOfferingLecturers, {
				token,
				id: offeringId as never,
				lecturerIds: editLecturers as never[]
			});
			editingLecturers = null;
			await load();
			reportSuccess(editLecturers.length > 0 ? 'Lecturers assigned.' : 'Offering unassigned.');
		} catch (err) {
			reportError(err, 'Could not assign lecturers.');
		}
	}

	/** Drop a lecturer chip onto a course: append them to its lecturers. */
	async function dropLecturer(e: DragEvent, o: Offering) {
		e.preventDefault();
		dropTarget = null;
		const id = e.dataTransfer?.getData('text/lams-lecturer') ?? '';
		if (!id) return;
		const lecturer = activeLecturers.find((l) => String(l._id) === id);
		if (!lecturer) return;
		const current = o.lecturerIds && o.lecturerIds.length > 0 ? [...o.lecturerIds] : [];
		if (current.includes(id)) {
			reportSuccess(`${lecturer.fullName} already teaches this course.`);
			return;
		}
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.setOfferingLecturers, {
				token,
				id: o._id as never,
				lecturerIds: [...current, id] as never[]
			});
			await load();
			reportSuccess(`${lecturer.fullName} now teaches ${o.courseCode}.`);
		} catch (err) {
			reportError(err, 'Could not assign that lecturer.');
		}
	}

	async function toggleOpen(offeringId: string, open: boolean) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.setOfferingOpen, { token, id: offeringId as never, open });
			await load();
			reportSuccess(
				open ? 'Students in this program can now join this course themselves.' : 'Self-enrolment closed.'
			);
		} catch (err) {
			reportError(err, 'Could not change enrolment.');
		}
	}

	async function removeOfferingRow(id: string, label: string) {
		if (!confirm(`Remove ${label} from its program? Enrolled students must be withdrawn first.`)) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeOffering, { token, id: id as never });
			await load();
		} catch (err) {
			reportError(err, 'Could not remove it.');
		}
	}

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

<div class="flex flex-col gap-4">
	{#if loading}
		<div class="h-24 animate-pulse rounded-md bg-muted"></div>
	{:else if student}
		{#if enrolledByProgram.length === 0 && joinable.length === 0}
			<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
				No courses yet. Ask your program rep or lecturer to add you to your program.
			</p>
		{:else}
			{#each enrolledByProgram as [programName, list] (programName)}
				<details open class="rounded-lg border border-border">
					<summary class="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
						<span class="flex flex-wrap items-center gap-2">
							<span class="text-sm font-bold text-lams-navy">{programName}</span>
							<Badge variant="outline">
								{list.length} course{list.length === 1 ? '' : 's'}
							</Badge>
						</span>
					</summary>
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
				</details>
			{/each}

			{#if joinable.length > 0}
				<div class="rounded-lg border border-lams-green/40">
					<p class="px-4 pt-3 text-sm font-bold text-lams-navy">Open to join</p>
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
		{/if}
	{:else if programsOrdered.length === 0}
		<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
			{admin
				? 'No programs yet. Create the first one below.'
				: 'Nothing assigned to you yet. Ask the admin to assign your courses.'}
		</p>
		{#if admin}
			<div class="rounded-md border border-dashed border-border p-3">
				<Button variant="ghost" size="sm" onclick={() => (showProgram = !showProgram)}>
					{showProgram ? 'Close' : '+ Add a program'}
				</Button>
				{#if showProgram}
					<form class="mt-2 grid gap-2 sm:grid-cols-[2fr_1fr_auto]" onsubmit={createProgram}>
						<div class="flex flex-col gap-1">
							<Label for="npn">Program name</Label>
							<Input id="npn" bind:value={newProgramName} placeholder="e.g. BSc Computer Science" required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="npy">Years</Label>
							<Input id="npy" type="number" min="1" max="10" bind:value={newProgramYears} required />
						</div>
						<div class="flex items-end">
							<Button type="submit" size="sm" disabled={busy}>Add program</Button>
						</div>
					</form>
				{/if}
			</div>
		{/if}
	{:else}
		{#if admin}
			<details class="rounded-lg border border-dashed border-border">
				<summary class="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
					<span class="text-sm font-medium text-muted-foreground">
						Course catalogue ({courses.length}) — drag a course onto a program to offer it there
					</span>
				</summary>
				<div class="flex flex-wrap gap-2 border-t border-border p-4">
					{#each courses as c (c._id)}
						<span
							role="button"
							tabindex="0"
							draggable="true"
							aria-label={`Drag ${c.code} to a program year`}
							title="Drag onto a program year below"
							class="cursor-grab rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium active:cursor-grabbing"
							ondragstart={(e) => {
								e.dataTransfer?.setData('text/lams-course', String(c._id));
								if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
							}}
						>
							{c.code} — {c.title}
						</span>
					{:else}
						<p class="text-xs text-muted-foreground">The catalogue is empty — add courses first.</p>
					{/each}
				</div>
			</details>
			<details class="rounded-lg border border-dashed border-border">
				<summary class="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
					<span class="text-sm font-medium text-muted-foreground">
						Lecturers ({activeLecturers.length}) — drag one onto a course to assign them
					</span>
				</summary>
				<div class="flex flex-wrap gap-2 border-t border-border p-4">
					{#each activeLecturers as l (l._id)}
						<span
							role="button"
							tabindex="0"
							draggable="true"
							aria-label={`Drag ${l.fullName} onto a course`}
							title="Drag onto a course below"
							class="cursor-grab rounded-full border border-lams-navy/30 bg-lams-navy/5 px-3 py-1 text-xs font-medium text-lams-navy active:cursor-grabbing"
							ondragstart={(e) => {
								e.dataTransfer?.setData('text/lams-lecturer', String(l._id));
								if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
							}}
						>
							{l.fullName} ({l.username})
						</span>
					{:else}
						<p class="text-xs text-muted-foreground">No active lecturers — create accounts first.</p>
					{/each}
				</div>
			</details>
		{/if}

		{#each semestersOrdered as sem, si (sem._id)}
			{@const semCount = offerings.filter((o) => String(o.semesterId) === String(sem._id)).length}
			{@const semPrograms = programsInSemester(String(sem._id))}
			{#if admin || semCount > 0}
				<details open={si === 0} class="rounded-lg border border-border">
					<summary class="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
						<span class="flex flex-wrap items-center gap-2">
							<span class="text-sm font-bold text-lams-navy">{sem.name} {sem.year}</span>
							<Badge variant="secondary">{sem.startDate} to {sem.endDate}</Badge>
							<Badge variant="outline">
								{semPrograms.length} program{semPrograms.length === 1 ? '' : 's'} · {semCount} course{semCount === 1 ? '' : 's'}
							</Badge>
						</span>
					</summary>
					<div class="flex flex-col gap-3 border-t border-border p-4">
						{#each yearsInSemester(String(sem._id)) as year (year)}
							{@const yearPrograms = programsInSemesterYear(String(sem._id), year)}
							<div class="rounded-md border border-border p-3">
								<p class="text-sm font-semibold">Year {year}</p>
								{#if yearPrograms.length === 0}
									<p class="mt-1 text-xs text-muted-foreground">No courses here yet.</p>
								{/if}
								{#each yearPrograms as p (p._id)}
									{@const key = `${String(p._id)}:Y${year}:S${String(sem._id)}`}
									{@const list = offeringsIn(String(p._id), year, String(sem._id))}
									<div
										role="region"
										aria-label={`${p.name} year ${year} courses`}
										class="mt-2 rounded-md border border-border p-3 {dropTarget === key
											? 'border-lams-green ring-2 ring-lams-green/40'
											: ''}"
										ondragover={(e) => {
											if (!admin) return;
											e.preventDefault();
											if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
											dropTarget = key;
										}}
										ondragleave={() => {
											if (dropTarget === key) dropTarget = null;
										}}
										ondrop={(e) => dropCourse(e, String(p._id), year, String(sem._id))}
									>
										<div class="flex flex-wrap items-center gap-2">
											<span class="text-sm font-semibold">{p.name}</span>
											<Badge variant="secondary">
												{list.length} course{list.length === 1 ? '' : 's'}
											</Badge>
										</div>

										{#if list.length === 0}
											<p class="mt-1 text-xs text-muted-foreground">
												{admin ? 'No courses yet — drag one here or offer below.' : 'No courses for you here yet.'}
											</p>
										{:else}
											<ul class="mt-1 flex flex-col divide-y divide-border">
												{#each list as o (o._id)}
													<li
														class="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between {dropTarget ===
														`L:${o._id}`
															? 'rounded-md bg-lams-green/5 ring-2 ring-lams-green/40'
															: ''}"
														ondragover={(e) => {
															if (!admin) return;
															if (!e.dataTransfer?.types.includes('text/lams-lecturer')) return;
															e.preventDefault();
															if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
															dropTarget = `L:${o._id}`;
														}}
														ondragleave={() => {
															if (dropTarget === `L:${o._id}`) dropTarget = null;
														}}
														ondrop={(e) => dropLecturer(e, o)}
													>
														<div>
															<p class="text-sm font-semibold">
																{o.courseCode} — {o.courseTitle}
																{#if o.hoursPerWeek}
																	<span class="font-normal text-muted-foreground">· {o.hoursPerWeek} h/week</span>
																{/if}
															</p>
															<p class="text-xs text-muted-foreground">
																{o.studentCount} student(s) ·
																{#if o.openForEnrolment}
																	<span class="font-medium text-emerald-700">open to students</span>
																{:else}
																	closed
																{/if}
																{#if lecturerNamesOf(o)}· {lecturerNamesOf(o)}{/if}
															</p>
															{#if admin && !lecturerNamesOf(o)}
																<p class="mt-0.5 text-xs">
																	<span class="font-semibold text-amber-700">Unassigned</span>
																	<span class="text-muted-foreground"> — no lecturer sees this course yet</span>
																</p>
															{/if}
														</div>
														<div class="flex flex-wrap items-center gap-2">
															{#if onroster}
																<Button variant="outline" size="sm" onclick={() => onroster?.(o)}>
																	Roster ({o.studentCount})
																</Button>
															{/if}
															{#if admin}
																{#if editingLecturers === o._id}
																	<div class="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
																		{#each activeLecturers as l (l._id)}
																			<div class="flex items-center gap-2">
																				<Checkbox
																					id={`ol-${o._id}-${l._id}`}
																					checked={editLecturers.includes(String(l._id))}
																					onCheckedChange={() => toggleEditLecturer(String(l._id))}
																				/>
																				<Label for={`ol-${o._id}-${l._id}`} class="text-xs font-normal">
																					{l.fullName} ({l.username})
																				</Label>
																			</div>
																		{/each}
																		<div class="flex gap-1 pt-1">
																			<Button size="sm" onclick={() => saveLecturers(o._id)}>Save</Button>
																			<Button size="sm" variant="ghost" onclick={() => (editingLecturers = null)}>
																				Cancel
																			</Button>
																		</div>
																	</div>
																{:else}
																	<Button
																		variant="outline"
																		size="sm"
																		onclick={() => {
																			editingLecturers = o._id;
																			editLecturers = o.lecturerIds && o.lecturerIds.length > 0 ? [...o.lecturerIds] : [];
																		}}
																	>
																		Lecturers ({(o.lecturerIds ?? []).length})
																	</Button>
																{/if}
																<Button variant="ghost" size="sm" class="text-red-700" onclick={() => removeOfferingRow(o._id, o.courseCode)}>
																	Remove
																</Button>
															{:else}
																<Button variant="outline" size="sm" onclick={() => toggleOpen(o._id, !o.openForEnrolment)}>
																	{o.openForEnrolment ? 'Close enrolment' : 'Let students join'}
																</Button>
															{/if}
														</div>
													</li>
												{/each}
											</ul>
										{/if}

										{#if admin}
											<div class="mt-2">
												<Button variant="ghost" size="sm" onclick={() => (showOffer[key] = !showOffer[key])}>
													{showOffer[key] ? 'Close' : '+ Add a course to this program'}
												</Button>
												{#if showOffer[key]}
													<div id="offer-{p._id}-{year}-{sem._id}" class="mt-2 flex flex-col gap-2 rounded-md border border-border p-3">
														<div class="grid gap-2 sm:grid-cols-[2fr_auto]">
															<Select.Root
																type="single"
																value={offerCourse[key] ?? NO_COURSE}
																onValueChange={(v) => {
																	offerCourse[key] = v === NO_COURSE ? '' : (v ?? '');
																}}
															>
																<Select.Trigger class="w-full">
																	<Select.Value placeholder="Choose a course" />
																</Select.Trigger>
																<Select.Content>
																	<Select.Group>
																		<Select.Item value={NO_COURSE} label="Choose a course">Choose a course</Select.Item>
																		{#each courses.filter((s) => !offeredCourseIds(String(p._id), year, String(sem._id)).has(String(s._id))) as s (s._id)}
																			<Select.Item value={s._id} label={`${s.code} — ${s.title}`}>
																				{s.code} — {s.title}
																			</Select.Item>
																		{/each}
																	</Select.Group>
																</Select.Content>
															</Select.Root>
															<Button
																size="sm"
																disabled={!offerCourse[key] || busy}
																onclick={() => offer(String(p._id), year, String(sem._id))}
															>
																Add course{(offerLecturers[key] ?? []).length > 0
																	? ` + ${(offerLecturers[key] ?? []).length} lecturer${(offerLecturers[key] ?? []).length === 1 ? '' : 's'}`
																	: ''}
															</Button>
														</div>
														<div class="flex flex-col gap-1">
															<span class="text-xs font-medium">
																Assign lecturers
																<span class="font-normal text-muted-foreground">
																	— whoever teaches it sees it in their console
																</span>
															</span>
															<div class="flex flex-wrap gap-x-4 gap-y-1">
																{#each activeLecturers as l (l._id)}
																	<div class="flex items-center gap-1.5">
																		<Checkbox
																			id={`nl-${key}-${l._id}`}
																			checked={(offerLecturers[key] ?? []).includes(String(l._id))}
																			onCheckedChange={() => toggleOfferLecturer(key, String(l._id))}
																		/>
																		<Label for={`nl-${key}-${l._id}`} class="text-xs font-normal">
																			{l.fullName}
																		</Label>
																	</div>
																{/each}
															</div>
															{#if !(offerCourse[key] && (offerLecturers[key] ?? []).length > 0)}
																<p class="text-xs text-muted-foreground">
																	Tip: pick the course and tick its lecturers, then add — or add
																	first and assign from the row afterwards.
																</p>
															{/if}
														</div>
													</div>
												{/if}
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{/each}
					</div>
				</details>
			{/if}
		{/each}
	{/if}
</div>
