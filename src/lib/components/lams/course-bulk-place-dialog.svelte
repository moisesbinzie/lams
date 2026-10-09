<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Check } from '@lucide/svelte';
	import type { Course, ProgramRow, Semester } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	/**
	 * Place one catalogue course into several programs at once.
	 *
	 * Same year, semester and lecturers for every target: the shared-course
	 * case is almost always "the same course, same term, everywhere". Anything
	 * already placed (or past a program's duration) is skipped with a reason,
	 * so a bulk place never half-fails.
	 */
	let {
		open = $bindable(false),
		token,
		courses,
		programs,
		semesters,
		lecturers,
		onplaced
	}: {
		open?: boolean;
		token: string;
		courses: Course[];
		programs: ProgramRow[];
		semesters: Semester[];
		lecturers: { _id: string; fullName: string; username: string; active: boolean }[];
		onplaced?: () => void | Promise<void>;
	} = $props();

	let courseId = $state('');
	let programIds = $state<string[]>([]);
	let year = $state(1);
	let semesterId = $state('');
	let lecturerIds = $state<string[]>([]);
	let busy = $state(false);

	const semestersOrdered = $derived([...semesters].sort((a, b) => b.year - a.year || a.number - b.number));
	const activeLecturers = $derived(lecturers.filter((l) => l.active));
	const selectedCourse = $derived(courses.find((c) => c._id === courseId) ?? null);
	const maxYears = $derived(
		programIds.length === 0
			? 10
			: Math.min(...programIds.map((id) => programs.find((p) => p._id === id)?.durationYears ?? 10))
	);

	$effect(() => {
		if (!open) return;
		courseId = '';
		programIds = [];
		year = 1;
		semesterId = semestersOrdered[0]?._id ?? '';
		lecturerIds = [];
	});

	function toggleProgram(id: string) {
		programIds = programIds.includes(id) ? programIds.filter((x) => x !== id) : [...programIds, id];
		if (year > (programs.find((p) => p._id === id)?.durationYears ?? 10) && programIds.includes(id)) {
			year = Math.min(year, programs.find((p) => p._id === id)?.durationYears ?? year);
		}
	}

	function toggleLecturer(id: string) {
		lecturerIds = lecturerIds.includes(id)
			? lecturerIds.filter((x) => x !== id)
			: [...lecturerIds, id];
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!courseId || programIds.length === 0 || !semesterId) return;
		busy = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.academics.createOfferingsBulk, {
				token,
				courseId: courseId as never,
				programIds: programIds as never[],
				semesterId: semesterId as never,
				yearOfStudy: year,
				lecturerIds: lecturerIds as never[]
			})) as { created: string[]; skipped: { program: string; reason: string }[] };
			open = false;
			await onplaced?.();
			const label = selectedCourse ? selectedCourse.code : 'Course';
			if (res.created.length === 0) {
				reportError(
					new Error(res.skipped.map((s) => `${s.program}: ${s.reason}`).join(' ')),
					`${label} was not placed anywhere.`
				);
			} else {
				reportSuccess(
					`${label} placed in ${res.created.join(', ')}.` +
						(res.skipped.length > 0
							? ` Skipped: ${res.skipped.map((s) => `${s.program} (${s.reason})`).join('; ')}.`
							: ''),
					8000
				);
			}
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
			<Dialog.Title>Place a course in several programs</Dialog.Title>
			<Dialog.Description>
				One course, one term — tick every program that teaches it. Placements that already
				exist are skipped, never duplicated.
			</Dialog.Description>
		</Dialog.Header>

		<form class="flex flex-col gap-4" onsubmit={submit}>
			<div class="flex flex-col gap-1.5">
				<Label for="bp-course">Course</Label>
				<Select.Root type="single" value={courseId} onValueChange={(v) => (courseId = v ?? '')}>
					<Select.Trigger id="bp-course" class="w-full">
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
			</div>

			<div class="flex flex-col gap-1.5">
				<span class="text-sm font-medium">Programs ({programIds.length} selected)</span>
				{#if programs.length === 0}
					<p class="text-xs text-muted-foreground">No programs yet.</p>
				{:else}
					<div class="flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded-md border border-border p-2">
						{#each programs as p (p._id)}
							<Button
								type="button"
								variant={programIds.includes(p._id) ? 'secondary' : 'outline'}
								size="sm"
								class="rounded-full"
								aria-pressed={programIds.includes(p._id)}
								onclick={() => toggleProgram(p._id)}
							>
								{#if programIds.includes(p._id)}
									<Check class="size-3.5" aria-hidden="true" />
								{/if}
								{p.name}
							</Button>
						{/each}
					</div>
				{/if}
			</div>

			<div class="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1">
					<Label for="bp-year">Year of study (all targets)</Label>
					<Input id="bp-year" type="number" min="1" max={maxYears} bind:value={year} />
					{#if programIds.length > 0}
						<span class="text-xs text-muted-foreground">Up to Year {maxYears} for this selection.</span>
					{/if}
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="bp-sem">Semester (all targets)</Label>
					<Select.Root type="single" value={semesterId} onValueChange={(v) => (semesterId = v ?? '')}>
						<Select.Trigger id="bp-sem" class="w-full">
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
			</div>

			{#if activeLecturers.length > 0}
				<div class="flex flex-col gap-1.5">
					<span class="text-sm font-medium">Lecturers (all targets)</span>
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
				</div>
			{/if}

			<div class="flex justify-end gap-2">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button
					type="submit"
					disabled={busy || !courseId || programIds.length === 0 || !semesterId}
				>
					{busy ? 'Placing…' : `Place in ${programIds.length} program${programIds.length === 1 ? '' : 's'}`}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
