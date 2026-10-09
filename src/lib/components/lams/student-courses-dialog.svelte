<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { BookOpen, Check, GraduationCap, X } from '@lucide/svelte';
	import type { PersonRow, StudentCourse, StudentCourseOption } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	/**
	 * The courses one student studies — reached from the student, which is the
	 * way round a person actually thinks about it ("what is Amina taking?")
	 * rather than from a course ("who is in BIT 221?").
	 *
	 * Everything is staged locally and written in one save. A student's set of
	 * courses is a single decision, so it should be a single transaction: the
	 * screen never has to reconcile a half-applied tick list, and the server
	 * refuses the whole thing if one course turns out to be out of reach.
	 */
	let {
		open = $bindable(false),
		token,
		person,
		onchanged
	}: {
		open?: boolean;
		token: string;
		person: PersonRow | null;
		onchanged?: () => void | Promise<void>;
	} = $props();

	let options = $state<StudentCourseOption[]>([]);
	let enrolled = $state<StudentCourse[]>([]);
	let loading = $state(false);
	let saving = $state(false);
	let search = $state('');
	/** Offering ids the user has added in this dialog, before saving. */
	let toAdd = $state<string[]>([]);
	/** Offering ids the user has removed in this dialog, before saving. */
	let toRemove = $state<string[]>([]);

	const optionsById = $derived(new Map(options.map((o) => [o.offeringId, o])));

	/** What the student will be taking if Save is pressed now. */
	const effective = $derived.by(() => {
		const keep = enrolled.filter((e) => !toRemove.includes(e.offeringId));
		const added = toAdd
			.map((id) => optionsById.get(id))
			.filter((o): o is StudentCourseOption => Boolean(o));
		return { keep, added };
	});

	const picks = $derived(
		options
			.filter((o) => !o.enrolled && !toAdd.includes(o.offeringId))
			.filter((o) => {
				const q = search.trim().toLowerCase();
				if (!q) return true;
				return (
					o.courseCode.toLowerCase().includes(q) ||
					o.courseTitle.toLowerCase().includes(q) ||
					o.programName.toLowerCase().includes(q) ||
					o.semesterName.toLowerCase().includes(q)
				);
			})
			.sort(
				(a, b) =>
					a.programName.localeCompare(b.programName) ||
					(a.yearOfStudy ?? 0) - (b.yearOfStudy ?? 0) ||
					a.semesterName.localeCompare(b.semesterName) ||
					a.courseCode.localeCompare(b.courseCode)
			)
	);

	const dirty = $derived(toAdd.length > 0 || toRemove.length > 0);

	$effect(() => {
		if (open && person) void load();
	});

	async function load() {
		if (!person) return;
		loading = true;
		toAdd = [];
		toRemove = [];
		search = '';
		try {
			const client = requireConvexClient();
			const [mine, every] = (await Promise.all([
				client.query(api.enrolments.listForPerson, { token, personId: person._id as never }),
				client.query(api.enrolments.listStudentCourses, { token, personId: person._id as never })
			])) as [StudentCourse[], StudentCourseOption[]];
			enrolled = mine;
			options = every;
		} catch (err) {
			reportError(err, 'Could not load that student’s courses.');
			enrolled = [];
			options = [];
		} finally {
			loading = false;
		}
	}

	function add(offeringId: string) {
		toRemove = toRemove.filter((id) => id !== offeringId);
		if (!toAdd.includes(offeringId)) toAdd = [...toAdd, offeringId];
	}

	function remove(offeringId: string) {
		toAdd = toAdd.filter((id) => id !== offeringId);
		if (!toRemove.includes(offeringId)) toRemove = [...toRemove, offeringId];
	}

	async function save() {
		if (!person) return;
		saving = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.enrolments.assignCoursesForStudent, {
				token,
				personId: person._id as never,
				enrolOfferingIds: toAdd as never[],
				dropOfferingIds: toRemove as never[]
			})) as { added: number; removed: number; unchanged: number };
			await load();
			await onchanged?.();
			const parts: string[] = [];
			if (res.added > 0) parts.push(`${res.added} added`);
			if (res.removed > 0) parts.push(`${res.removed} withdrawn`);
			reportSuccess(
				parts.length > 0
					? `${person.fullName}: ${parts.join(', ')}.`
					: 'Nothing changed — that was already their set of courses.'
			);
		} catch (err) {
			reportError(err, 'Could not save those courses.');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Courses for {person?.fullName ?? 'this student'}</Dialog.Title>
			<Dialog.Description>
				{#if person}
					<span class="font-mono">{person.regNumber}</span> · every course open to them, from
					every program they belong to. Withdrawing a course removes them from its register; the
					attendance already recorded is kept.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if loading}
			<div class="flex flex-col gap-2">
				<div class="h-8 animate-pulse rounded-md bg-muted"></div>
				<div class="h-32 animate-pulse rounded-md bg-muted"></div>
			</div>
		{:else if !person}
			<p class="text-sm text-muted-foreground">No student selected.</p>
		{:else if person.programIds.length === 0}
			<p class="rounded-md border border-dashed border-amber-300 bg-amber-50/60 p-4 text-sm text-amber-900">
				This student belongs to no program, so there is nothing to give them yet. Use
				<strong>Edit</strong> on their row to put them in a program first.
			</p>
		{:else}
			<div class="flex flex-col gap-4">
				<section class="flex flex-col gap-2">
					<h3 class="flex flex-wrap items-center gap-2 text-sm font-semibold">
						<GraduationCap class="size-4 text-lams-navy" aria-hidden="true" />
						Studying now
						<Badge variant="secondary">{effective.keep.length + effective.added.length}</Badge>
						{#if dirty}
							<Badge class="bg-amber-600 text-white">Unsaved changes</Badge>
						{/if}
					</h3>
					{#if effective.keep.length === 0 && effective.added.length === 0}
						<p class="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
							Not taking anything yet. Add a course from the list below.
						</p>
					{:else}
						<ul class="flex flex-col divide-y divide-border rounded-md border border-border">
							{#each effective.keep as c (c.offeringId)}
								<li class="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
									<span class="min-w-0">
										<span class="font-mono font-medium">{c.courseCode}</span> — {c.courseTitle}
										<span class="block text-xs text-muted-foreground">
											{c.programName} · Year {c.yearOfStudy ?? '—'} · {c.semesterName} ·
											{c.meetingCount} slot{c.meetingCount === 1 ? '' : 's'} · added by {c.addedBy}
										</span>
									</span>
									<Button
										variant="ghost"
										size="sm"
										class="text-red-700"
										onclick={() => remove(c.offeringId)}
									>
										<X class="size-3.5" aria-hidden="true" /> Withdraw
									</Button>
								</li>
							{/each}
							{#each effective.added as c (c.offeringId)}
								<li class="flex flex-wrap items-center justify-between gap-2 bg-emerald-50/60 p-2 text-sm">
									<span class="min-w-0">
										<span class="font-mono font-medium">{c.courseCode}</span> — {c.courseTitle}
										<span class="block text-xs text-muted-foreground">
											{c.programName} · Year {c.yearOfStudy ?? '—'} · {c.semesterName}
										</span>
									</span>
									<span class="flex items-center gap-2">
										<Badge class="bg-emerald-600 text-white">
											<Check class="size-3" aria-hidden="true" /> Will be added
										</Badge>
										<Button variant="ghost" size="sm" onclick={() => remove(c.offeringId)}>Undo</Button>
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<section class="flex flex-col gap-2">
					<h3 class="flex flex-wrap items-center gap-2 text-sm font-semibold">
						<BookOpen class="size-4 text-lams-navy" aria-hidden="true" />
						Available in their programs
						<Badge variant="secondary">{picks.length}</Badge>
					</h3>
					<Input bind:value={search} placeholder="Search course, program or semester" aria-label="Search available courses" />
					{#if picks.length === 0}
						<p class="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
							{options.length === 0
								? 'No courses are placed in this student’s programs yet. Place courses on the Programs tab first.'
								: 'Nothing left to add — they are taking everything available, or the search hides it.'}
						</p>
					{:else}
						<ul class="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border">
							{#each picks as o (o.offeringId)}
								<li class="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
									<span class="min-w-0">
										<span class="font-mono font-medium">{o.courseCode}</span> — {o.courseTitle}
										<span class="block text-xs text-muted-foreground">
											{o.programName} · Year {o.yearOfStudy ?? '—'} · {o.semesterName}
											{#if o.openForEnrolment}
												<span class="text-emerald-700">· open to join</span>
											{/if}
										</span>
									</span>
									<Button variant="outline" size="sm" onclick={() => add(o.offeringId)}>Add</Button>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<div class="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
					{#if dirty}
						<Button
							variant="ghost"
							onclick={() => {
								toAdd = [];
								toRemove = [];
							}}
						>
							Discard changes
						</Button>
					{/if}
					<Button variant="outline" onclick={() => (open = false)}>Close</Button>
					<Button disabled={saving || !dirty} onclick={save}>
						{saving ? 'Saving…' : 'Save courses'}
					</Button>
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
