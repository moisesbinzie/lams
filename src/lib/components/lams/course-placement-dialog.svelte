<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Check, Plus } from '@lucide/svelte';
	import type { Course, ProgramRow, Semester } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	/**
	 * Place one course in the program, at a year and a semester.
	 *
	 * One dialog for both halves of the job, because they are one decision: a
	 * course is either already in the catalogue (pick it) or it does not exist
	 * yet (write its code and title). Splitting this into "add a course" and
	 * "offer a course" is what made the old screens confusing — it left people
	 * with catalogue entries nothing was taking.
	 */
	let {
		open = $bindable(false),
		token,
		program,
		semesters,
		courses,
		lecturers,
		defaultYear = 1,
		defaultSemesterId = '',
		/** Course codes already placed in this program, so repeats are a choice, not a slip. */
		placedKeys = [],
		onplaced
	}: {
		open?: boolean;
		token: string;
		program: ProgramRow | null;
		semesters: Semester[];
		courses: Course[];
		lecturers: { _id: string; fullName: string; username: string; active: boolean }[];
		defaultYear?: number;
		defaultSemesterId?: string;
		/** `${courseId}` values already in this program, for the duplicate warning. */
		placedKeys?: string[];
		onplaced?: () => void | Promise<void>;
	} = $props();

	const NEW_COURSE = 'new-course';

	let mode = $state<'existing' | 'new'>('existing');
	let courseId = $state('');
	let newCode = $state('');
	let newTitle = $state('');
	let newHours = $state('3');
	let year = $state(1);
	let semesterId = $state('');
	let lecturerIds = $state<string[]>([]);
	let openForEnrolment = $state(false);
	let busy = $state(false);

	const years = $derived(
		Array.from({ length: Math.max(1, Math.min(10, program?.durationYears ?? 1)) }, (_, i) => i + 1)
	);
	const semestersOrdered = $derived([...semesters].sort((a, b) => b.year - a.year || a.number - b.number));
	const activeLecturers = $derived(lecturers.filter((l) => l.active));
	const selectedCourse = $derived(courses.find((c) => c._id === courseId) ?? null);
	/** A second placement of a course already in this program: allowed, but worth flagging. */
	const isRepeat = $derived(Boolean(selectedCourseId()) && placedKeys.includes(selectedCourseId()));

	function selectedCourseId(): string {
		return mode === 'existing' ? courseId : '';
	}

	// Reopening the dialog should always start from the same, predictable place.
	$effect(() => {
		if (!open) return;
		mode = courses.length > 0 ? 'existing' : 'new';
		courseId = '';
		newCode = '';
		newTitle = '';
		newHours = '3';
		year = Math.min(Math.max(1, defaultYear), Math.max(1, program?.durationYears ?? 1));
		semesterId = defaultSemesterId || (semestersOrdered[0]?._id ?? '');
		lecturerIds = [];
		openForEnrolment = false;
	});

	function toggleLecturer(id: string) {
		lecturerIds = lecturerIds.includes(id)
			? lecturerIds.filter((x) => x !== id)
			: [...lecturerIds, id];
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!program) return;
		if (!semesterId) {
			reportError(new Error('Choose a semester.'), 'A course has to sit in a semester.');
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			let id = courseId;
			let label = selectedCourse ? `${selectedCourse.code} — ${selectedCourse.title}` : '';
			if (mode === 'new') {
				await client.mutation(api.academics.createCourse, {
					token,
					code: newCode.trim(),
					title: newTitle.trim(),
					hoursPerWeek: Number(newHours) || undefined
				});
				// createCourse returns the new id, but the catalogue is re-read by the
				// caller straight afterwards, so look the code up rather than trusting
				// a stale list here.
				const fresh = (await client.query(api.academics.listCourses, { token })) as unknown as Course[];
				const match = fresh.find((c) => c.code === newCode.trim().toUpperCase());
				if (!match) throw new Error('The course was created but could not be found again.');
				id = match._id;
				label = `${match.code} — ${match.title}`;
			}
			if (!id) throw new Error('Choose a course to place.');
			await client.mutation(api.academics.createOffering, {
				token,
				courseId: id as never,
				programId: program._id as never,
				semesterId: semesterId as never,
				yearOfStudy: year,
				openForEnrolment,
				lecturerIds: lecturerIds as never[]
			});
			open = false;
			await onplaced?.();
			reportSuccess(`${label} placed in ${program.name} — Year ${year}.`, 7000);
		} catch (err) {
			reportError(err, 'Could not place that course.');
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Place a course in {program?.name ?? 'this program'}</Dialog.Title>
			<Dialog.Description>
				A course is saved once in the catalogue and can then be placed in as many programs as
				teach it. Here you choose where it sits: which year of study, and which semester.
			</Dialog.Description>
		</Dialog.Header>

		<div class="mb-3 flex gap-1 rounded-full border border-border p-1" role="tablist" aria-label="Course source">
			<Button
				variant={mode === 'existing' ? 'secondary' : 'ghost'}
				size="sm"
				class="flex-1 rounded-full"
				role="tab"
				aria-selected={mode === 'existing'}
				disabled={courses.length === 0}
				onclick={() => (mode = 'existing')}
			>
				From the catalogue ({courses.length})
			</Button>
			<Button
				variant={mode === 'new' ? 'secondary' : 'ghost'}
				size="sm"
				class="flex-1 rounded-full"
				role="tab"
				aria-selected={mode === 'new'}
				onclick={() => (mode = 'new')}
			>
				<Plus class="size-3.5" aria-hidden="true" /> New course
			</Button>
		</div>

		<form class="flex flex-col gap-4" onsubmit={submit}>
			{#if mode === 'existing'}
				<div class="flex flex-col gap-1.5">
					<Label for="pl-course">Course</Label>
					<Select.Root
						type="single"
						value={courseId}
						onValueChange={(v) => (courseId = v ?? '')}
						items={courses.map((c) => ({ value: c._id, label: `${c.code} — ${c.title}` }))}
					>
						<Select.Trigger id="pl-course" class="w-full">
							<Select.Value placeholder="Choose a course" />
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each courses as c (c._id)}
									<Select.Item value={c._id} label={`${c.code} — ${c.title}`}>
										{c.code} — {c.title}
									</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
					{#if isRepeat}
						<p class="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
							This course is already placed in {program?.name}. Placing it again is how a
							repeating student meets it in a later year or semester — carry on if that is what
							you mean, or use the existing card instead.
						</p>
					{/if}
				</div>
			{:else}
				<div class="grid gap-3 sm:grid-cols-[1fr_1.6fr_auto]">
					<div class="flex flex-col gap-1">
						<Label for="pl-code">Code</Label>
						<Input id="pl-code" bind:value={newCode} placeholder="e.g. BIT 221" required />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="pl-title">Title</Label>
						<Input id="pl-title" bind:value={newTitle} placeholder="e.g. Database Systems" required />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="pl-hours">Hours/week</Label>
						<Input id="pl-hours" type="number" min="1" max="20" bind:value={newHours} />
					</div>
				</div>
			{/if}

			<div class="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="pl-year">Year of study</Label>
					<Select.Root
						type="single"
						value={String(year)}
						onValueChange={(v) => (year = Number(v ?? 1))}
						items={years.map((y) => ({ value: String(y), label: `Year ${y}` }))}
					>
						<Select.Trigger id="pl-year" class="w-full">
							<Select.Value placeholder="Choose a year" />
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each years as y (y)}
									<Select.Item value={String(y)} label={`Year ${y}`}>Year {y}</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="pl-sem">Semester</Label>
					{#if semestersOrdered.length === 0}
						<p class="rounded-md border border-dashed border-amber-300 p-2 text-xs text-amber-900">
							No semesters exist yet. Create the academic year first.
						</p>
					{:else}
						<Select.Root
							type="single"
							value={semesterId}
							onValueChange={(v) => (semesterId = v ?? '')}
							items={semestersOrdered.map((s) => ({ value: s._id, label: `${s.name} · ${s.year}` }))}
						>
							<Select.Trigger id="pl-sem" class="w-full">
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
					{/if}
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<span class="text-sm font-medium">
					Lecturers
					<span class="font-normal text-muted-foreground">
						— optional. Only whoever holds the course sees it in their console.
					</span>
				</span>
				{#if activeLecturers.length === 0}
					<p class="text-xs text-muted-foreground">
						No active lecturer accounts yet. You can place the course now and assign someone
						later from its card.
					</p>
				{:else}
					<div class="flex flex-wrap gap-2">
						{#each activeLecturers as l (l._id)}
							<Button
								type="button"
								variant={lecturerIds.includes(l._id) ? 'secondary' : 'outline'}
								size="sm"
								class="rounded-full"
								aria-pressed={lecturerIds.includes(l._id)}
								onclick={() => toggleLecturer(l._id)}
							>
								{#if lecturerIds.includes(l._id)}
									<Check class="size-3.5" aria-hidden="true" />
								{/if}
								{l.fullName}
							</Button>
						{/each}
					</div>
				{/if}
			</div>

			<label class="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
				<input type="checkbox" bind:checked={openForEnrolment} class="mt-0.5 size-4" />
				<span>
					<strong>Let students join this course themselves</strong>
					<span class="block text-xs text-muted-foreground">
						Off by default. You can still assign students by hand from the Students tab.
					</span>
				</span>
			</label>

			<div class="flex justify-end gap-2">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={busy || !semesterId || (mode === 'existing' && !courseId)}>
					{busy ? 'Placing…' : 'Place course'}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
