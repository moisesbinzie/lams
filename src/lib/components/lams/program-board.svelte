<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import * as Select from '$lib/components/ui/select';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Popover from '$lib/components/ui/popover';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import {
		BookOpen,
		CalendarDays,
		GraduationCap,
		Plus,
		Trash2,
		UserRound,
		UserRoundPlus,
		Users
	} from '@lucide/svelte';
	import type { ProgramCoursePlacement, ProgramRow, Semester, StaffRow } from '$lib/lams/types';

	/**
	 * One program, opened up: its years of study as tabs, and inside each year
	 * its semesters as columns of course cards.
	 *
	 * The whole point of this shape is the semester. A course is not simply "in"
	 * a program — it is taught in a particular year, in a particular semester,
	 * which is also what a timetable and a set of lecture records hang off. The
	 * columns make that visible instead of burying it in a form field.
	 *
	 * Semester fallback: only the semesters a program actually uses are shown as
	 * tabs. If a program has no placements yet, every semester is offered, so a
	 * brand-new program is not a dead end.
	 */
	let {
		program,
		semesters,
		placements,
		lecturers,
		isAdmin,
		anchorYear = null,
		loading = false,
		busy = false,
		onadd,
		ontoggleopen,
		onsetlecturers,
		onroster,
		onremove
	}: {
		program: ProgramRow;
		semesters: Semester[];
		placements: ProgramCoursePlacement[];
		lecturers: StaffRow[];
		isAdmin: boolean;
		anchorYear?: number | null;
		loading?: boolean;
		busy?: boolean;
		onadd?: (year: number, semesterId: string) => void;
		ontoggleopen?: (placement: ProgramCoursePlacement, open: boolean) => void | Promise<void>;
		onsetlecturers?: (placement: ProgramCoursePlacement, ids: string[]) => void | Promise<void>;
		onroster?: (placement: ProgramCoursePlacement) => void;
		onremove?: (placement: ProgramCoursePlacement) => void;
	} = $props();

	let activeYear = $state('');
	let activeSemester = $state('');
	/** Which placement's "Lecturers" popover is open, by id. */
	let lecturerFor = $state<string | null>(null);
	let lecturerDraft = $state<string[]>([]);

	const activeLecturers = $derived(lecturers.filter((l) => l.active));
	const years = $derived(
		Array.from({ length: Math.max(1, Math.min(10, program.durationYears ?? 1)) }, (_, i) => i + 1)
	);
	/** Semesters newest first — the year being worked on is almost always the top one. */
	const semestersOrdered = $derived([...semesters].sort((a, b) => b.year - a.year || a.number - b.number));

	const usedSemesterIds = $derived(new Set(placements.map((p) => p.semesterId)));
	/** Active year's semesters first, then newest-first — the working year stays on top. */
	const semestersToShow = $derived.by(() => {
		const pool =
			usedSemesterIds.size === 0
				? semestersOrdered
				: semestersOrdered.filter((s) => usedSemesterIds.has(s._id));
		if (anchorYear == null) return pool;
		return [...pool].sort((a, b) => {
			const aa = a.year === anchorYear ? 0 : 1;
			const bb = b.year === anchorYear ? 0 : 1;
			if (aa !== bb) return aa - bb;
			return b.year - a.year || a.number - b.number;
		});
	});

	// Keep the selected tab valid as the program changes underneath us.
	$effect(() => {
		const allowed = years.map(String);
		if (!allowed.includes(activeYear)) activeYear = allowed[0] ?? '1';
	});
	$effect(() => {
		const allowed = semestersToShow.map((s) => s._id);
		if (!allowed.includes(activeSemester)) activeSemester = allowed[0] ?? '';
	});

	function placementsIn(year: number, semesterId: string): ProgramCoursePlacement[] {
		return placements
			.filter((p) => (p.yearOfStudy ?? 0) === year && p.semesterId === semesterId)
			.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
	}

	/** How many of this program's courses are still waiting for a lecturer. */
	const unassigned = $derived(placements.filter((p) => p.lecturerIds.length === 0).length);

	function lecturerLine(p: ProgramCoursePlacement): string {
		return p.lecturerNames.length > 0 ? p.lecturerNames.join(', ') : '';
	}

	function openLecturers(p: ProgramCoursePlacement) {
		lecturerDraft = [...p.lecturerIds];
		lecturerFor = lecturerFor === p._id ? null : p._id;
	}

	function toggleDraft(id: string) {
		lecturerDraft = lecturerDraft.includes(id)
			? lecturerDraft.filter((x) => x !== id)
			: [...lecturerDraft, id];
	}

	async function saveLecturers(p: ProgramCoursePlacement) {
		await onsetlecturers?.(p, lecturerDraft);
		lecturerFor = null;
	}
</script>

<Card.Root>
	<Card.Header>
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="min-w-0">
				<Card.Title class="flex flex-wrap items-center gap-2 text-base">
					{program.name}
					<Badge variant="secondary">
						<GraduationCap class="size-3" aria-hidden="true" />
						{program.durationYears} year{program.durationYears === 1 ? '' : 's'}
					</Badge>
					<Badge variant="outline">
						<BookOpen class="size-3" aria-hidden="true" />
						{placements.length} course{placements.length === 1 ? '' : 's'}
					</Badge>
					{#if unassigned > 0}
						<Badge class="bg-amber-600 text-white">{unassigned} without a lecturer</Badge>
					{/if}
				</Card.Title>
				<Card.Description>
					{#if isAdmin}
						Courses placed year by year and semester by semester. One course can be placed in
						as many programs as teach it.
					{:else}
						The courses you teach in this program, by year and semester.
					{/if}
				</Card.Description>
			</div>
			{#if isAdmin}
				<Button size="sm" onclick={() => onadd?.(Number(activeYear) || 1, activeSemester)}>
					<Plus class="size-3.5" aria-hidden="true" /> Place a course
				</Button>
			{/if}
		</div>
	</Card.Header>

	<Card.Content class="flex flex-col gap-4">
		{#if semestersToShow.length === 0}
			<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
				No semesters exist yet. Create the academic year first — a course has to be placed in a
				semester.
			</p>
		{:else if loading}
			<div class="flex flex-col gap-2">
				<div class="h-8 w-56 animate-pulse rounded-md bg-muted"></div>
				<div class="h-32 animate-pulse rounded-md bg-muted"></div>
			</div>
		{:else}
			<Tabs.Root bind:value={activeYear}>
				<Tabs.List class="h-auto flex-wrap justify-start gap-1">
					{#each years as y (y)}
						<Tabs.Trigger value={String(y)} class="flex-1 sm:flex-none">Year {y}</Tabs.Trigger>
					{/each}
				</Tabs.List>
				{#each years as y (y)}
					<Tabs.Content value={String(y)} class="mt-4">
						<div class="grid gap-4 lg:grid-cols-2">
							{#each semestersToShow as s (s._id)}
								{@const list = placementsIn(y, s._id)}
								<section
									class="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3"
									aria-label={`${s.name} ${s.year} in year ${y}`}
								>
									<header class="flex flex-wrap items-center justify-between gap-2">
										<span class="flex flex-wrap items-center gap-2">
											<span class="text-sm font-bold text-lams-navy">{s.name}</span>
											<Badge variant="outline">{s.year}</Badge>
											<Badge variant="secondary">
												{list.length} course{list.length === 1 ? '' : 's'}
											</Badge>
										</span>
										{#if isAdmin}
											<Button
												variant="ghost"
												size="sm"
												onclick={() => onadd?.(y, s._id)}
												aria-label={`Place a course in ${s.name} ${s.year}, year ${y}`}
											>
												<Plus class="size-3.5" aria-hidden="true" /> Add
											</Button>
										{/if}
									</header>

									{#if list.length === 0}
										<p
											class="rounded-md border border-dashed border-border bg-background p-3 text-center text-xs text-muted-foreground"
										>
											{isAdmin ? 'Nothing placed here yet.' : 'No courses for you here.'}
										</p>
									{:else}
										<ul class="flex flex-col gap-2">
											{#each list as p (p._id)}
												<li
													class="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
												>
													<div class="flex flex-wrap items-start justify-between gap-2">
														<div class="min-w-0">
															<p class="text-sm font-semibold">
																<span class="font-mono">{p.courseCode}</span>
																<span class="text-muted-foreground"> — </span>
																{p.courseTitle}
															</p>
															<p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
																{#if p.hoursPerWeek}
																	<span>{p.hoursPerWeek} h/week</span>
																{/if}
																<span class="flex items-center gap-1">
																	<Users class="size-3" aria-hidden="true" />
																	{p.studentCount} student{p.studentCount === 1 ? '' : 's'}
																</span>
																<span class="flex items-center gap-1">
																	<CalendarDays class="size-3" aria-hidden="true" />
																	{p.meetingCount} slot{p.meetingCount === 1 ? '' : 's'}
																</span>
															</p>
														</div>
														{#if p.openForEnrolment}
															<Badge class="bg-emerald-600 text-white">Open to join</Badge>
														{:else}
															<Badge variant="secondary">Closed</Badge>
														{/if}
													</div>

													<p class="flex flex-wrap items-center gap-1 text-xs">
														<UserRound class="size-3 text-muted-foreground" aria-hidden="true" />
														{#if lecturerLine(p)}
															<span class="font-medium">{lecturerLine(p)}</span>
														{:else}
															<span class="font-semibold text-amber-700">No lecturer yet</span>
															<span class="text-muted-foreground">— nobody sees this course</span>
														{/if}
													</p>

													<div class="flex flex-wrap items-center gap-1">
														{#if onroster}
															<Button variant="outline" size="sm" onclick={() => onroster?.(p)}>
																<Users class="size-3.5" aria-hidden="true" /> Students ({p.studentCount})
															</Button>
														{/if}
														{#if isAdmin}
															<Popover.Root
																open={lecturerFor === p._id}
																onOpenChange={(o) => {
																	if (o) openLecturers(p);
																	else lecturerFor = null;
																}}
															>
																<Popover.Trigger>
																	{#snippet child({ props })}
																		<Button {...props} variant="outline" size="sm">
																			<UserRoundPlus class="size-3.5" aria-hidden="true" />
																			Lecturers ({p.lecturerIds.length})
																		</Button>
																	{/snippet}
																</Popover.Trigger>
																<Popover.Content class="w-72" align="start">
																	<p class="text-sm font-medium">Who teaches {p.courseCode}?</p>
																	{#if activeLecturers.length === 0}
																		<p class="text-xs text-muted-foreground">
																			No active lecturer accounts. Create one in the admin console.
																		</p>
																	{:else}
																		<div class="flex max-h-52 flex-col gap-2 overflow-y-auto">
																			{#each activeLecturers as l (l._id)}
																				<div class="flex items-center gap-2">
																					<Checkbox
																						id={`cl-${p._id}-${l._id}`}
																						checked={lecturerDraft.includes(l._id)}
																						onCheckedChange={() => toggleDraft(l._id)}
																					/>
																					<Label for={`cl-${p._id}-${l._id}`} class="text-xs font-normal">
																						{l.fullName} ({l.username})
																					</Label>
																				</div>
																			{/each}
																		</div>
																		<div class="flex justify-end gap-1">
																			<Button size="sm" variant="ghost" onclick={() => (lecturerFor = null)}>
																				Cancel
																			</Button>
																			<Button size="sm" disabled={busy} onclick={() => saveLecturers(p)}>
																				Save
																			</Button>
																		</div>
																	{/if}
																</Popover.Content>
															</Popover.Root>

															<Button
																variant="outline"
																size="sm"
																onclick={() => ontoggleopen?.(p, !p.openForEnrolment)}
															>
																{p.openForEnrolment ? 'Close enrolment' : 'Let students join'}
															</Button>
														{/if}
													</div>

													{#if isAdmin}
														<div class="flex justify-end border-t border-border pt-2">
															<AlertDialog.Root>
																<AlertDialog.Trigger
																	class="flex items-center gap-1 text-xs text-red-700 hover:underline"
																	disabled={busy}
																>
																	<Trash2 class="size-3" aria-hidden="true" /> Remove from program
																</AlertDialog.Trigger>
																<AlertDialog.Content>
																	<AlertDialog.Header>
																		<AlertDialog.Title>
																			Remove {p.courseCode} from {program.name}?
																		</AlertDialog.Title>
																		<AlertDialog.Description>
																			This removes the placement, not the course. It only works while
																			no student is enrolled and no lecture has been recorded — the
																			catalogue entry itself is never touched.
																		</AlertDialog.Description>
																	</AlertDialog.Header>
																	<AlertDialog.Footer>
																		<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
																		<AlertDialog.Action onclick={() => onremove?.(p)}>
																			Remove
																		</AlertDialog.Action>
																	</AlertDialog.Footer>
																</AlertDialog.Content>
															</AlertDialog.Root>
														</div>
													{/if}
												</li>
											{/each}
										</ul>
									{/if}
								</section>
							{/each}
						</div>
					</Tabs.Content>
				{/each}
			</Tabs.Root>
		{/if}

		{#if placements.length === 0 && semestersToShow.length > 0 && !loading}
			<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
				{isAdmin
					? 'Nothing placed in this program yet. Use “Place a course” to add its first course.'
					: 'No courses assigned to you in this program yet.'}
			</p>
		{/if}
	</Card.Content>
</Card.Root>
