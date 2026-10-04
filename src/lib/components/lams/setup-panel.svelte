<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import { TriangleAlert, Pencil } from '@lucide/svelte';
	import ClassPicker from './class-picker.svelte';
	import type { ClassRow, Semester } from '$lib/lams/types';

	let token = getToken();
	let semesters = $state<Semester[]>([]);
	let classes = $state<ClassRow[]>([]);
	let classId = $state('');
	let loading = $state(true);
	let error = $state('');
	let notice = $state('');
	let busy = $state(false);

	// New semester form.
	let semName = $state('');
	let semYear = $state(String(new Date().getFullYear()));
	let semNumber = $state('1');
	let semStart = $state('');
	let semEnd = $state('');

	// New class form.
	let newClassName = $state('');
	let newClassYear = $state('1');
	let newClassSemester = $state('');

	// Edit-class dialog.
	let editOpen = $state(false);
	let editId = $state('');
	let editName = $state('');
	let editYear = $state('1');
	let editSemester = $state('');

	const yearOptions = $derived.by(() => {
		const y = Number(semYear) || new Date().getFullYear();
		return [y - 1, y, y + 1].map((v) => String(v));
	});

	async function loadSemesters() {
		const client = requireConvexClient();
		semesters = (await client.query(api.academics.listSemesters, { token })) as unknown as Semester[];
	}

	async function loadClasses() {
		const client = requireConvexClient();
		classes = (await client.query(api.academics.listClasses, { token })) as unknown as ClassRow[];
	}

	onMount(async () => {
		if (!token) return;
		try {
			await Promise.all([loadSemesters(), loadClasses()]);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load the setup data.';
		} finally {
			loading = false;
		}
	});

	async function createSemester(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.createSemester, {
				token,
				name: semName.trim(),
				year: Number(semYear),
				number: Number(semNumber),
				startDate: semStart,
				endDate: semEnd
			});
			semName = '';
			semStart = '';
			semEnd = '';
			await loadSemesters();
			notice = 'Semester created. Now add a class to it.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not create the semester.';
		} finally {
			busy = false;
		}
	}

	async function removeSemester(id: string) {
		error = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeSemester, { token, id: id as never });
			await Promise.all([loadSemesters(), loadClasses()]);
			notice = 'Semester removed.';
		} catch (err) {
			// The server refuses while offerings or classes still use it.
			error = err instanceof Error ? err.message : 'Could not remove the semester.';
		}
	}

	async function createClass(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.createClass, {
				token,
				name: newClassName.trim(),
				yearOfStudy: Number(newClassYear),
				...(newClassSemester ? { semesterId: newClassSemester as never } : {})
			});
			newClassName = '';
			await loadClasses();
			notice = 'Class created. Add its students next.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not create the class.';
		} finally {
			busy = false;
		}
	}

	function openEdit(c: ClassRow) {
		editId = c._id;
		editName = c.name;
		editYear = String(c.yearOfStudy);
		editSemester = c.semesterId ?? '';
		editOpen = true;
	}

	async function saveEdit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.updateClass, {
				token,
				id: editId as never,
				name: editName.trim(),
				yearOfStudy: Number(editYear),
				semesterId: (editSemester || undefined) as never
			});
			editOpen = false;
			await loadClasses();
			notice = 'Class updated.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not update the class.';
		} finally {
			busy = false;
		}
	}

	async function removeClass() {
		error = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeClass, { token, id: editId as never });
			editOpen = false;
			classId = '';
			await loadClasses();
			notice = 'Class removed.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not remove the class.';
		}
	}
</script>

<div class="flex flex-col gap-4">
	{#if error}
		<p class="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800" role="alert">
			<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<span>{error}</span>
		</p>
	{/if}
	{#if notice}
		<p class="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900" role="status">{notice}</p>
	{/if}

	{#if loading}
		<div class="flex flex-col gap-2">
			<div class="h-6 w-52 animate-pulse rounded-md bg-muted"></div>
			<div class="h-20 animate-pulse rounded-md bg-muted"></div>
		</div>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title>Semesters</Card.Title>
				<Card.Description>
					Subjects are offered per semester, so create the current one first.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{#if semesters.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						No semesters yet. Create the first one below.
					</p>
				{:else}
					<ul class="flex flex-col divide-y divide-border">
						{#each semesters as s (s._id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
								<span>
									<strong>{s.name}</strong>
									<span class="text-xs text-muted-foreground">
										· {s.startDate} to {s.endDate}
									</span>
								</span>
								<AlertDialog.Root>
									<AlertDialog.Trigger
										class="text-xs text-red-700 underline"
										disabled={busy}
									>
										Remove
									</AlertDialog.Trigger>
									<AlertDialog.Content>
										<AlertDialog.Header>
											<AlertDialog.Title>Remove {s.name}?</AlertDialog.Title>
											<AlertDialog.Description>
												This only works while no class or subject uses the semester.
											</AlertDialog.Description>
										</AlertDialog.Header>
										<AlertDialog.Footer>
											<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
											<AlertDialog.Action onclick={() => removeSemester(s._id)}>Remove</AlertDialog.Action>
										</AlertDialog.Footer>
									</AlertDialog.Content>
								</AlertDialog.Root>
							</li>
						{/each}
					</ul>
				{/if}

				<form class="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1.5fr_1.5fr_auto]" onsubmit={createSemester}>
					<div class="flex flex-col gap-1">
						<Label for="semn">Name</Label>
						<Input id="semn" bind:value={semName} placeholder="e.g. Semester 1" required />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="iemy">Year</Label>
						<select id="iemy" class="w-full rounded-md border border-input bg-background p-2 text-sm" bind:value={semYear}>
							{#each yearOptions as y (y)}
								<option value={y}>{y}</option>
							{/each}
						</select>
					</div>
					<div class="flex flex-col gap-1">
						<Label for="iemn">No.</Label>
						<select id="iemn" class="w-full rounded-md border border-input bg-background p-2 text-sm" bind:value={semNumber}>
							<option value="1">1</option>
							<option value="2">2</option>
							<option value="3">3</option>
						</select>
					</div>
					<div class="flex flex-col gap-1">
						<Label for="sems">Starts</Label>
						<Input id="sems" type="date" bind:value={semStart} required />
					</div>
					<div class="flex flex-col gap-1">
						<Label for="seme">Ends</Label>
						<Input id="seme" type="date" bind:value={semEnd} required />
					</div>
					<div class="flex items-end">
						<Button type="submit" disabled={busy}>Add semester</Button>
					</div>
				</form>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Classes</Card.Title>
				<Card.Description>
					A class is a cohort, e.g. “BSc Computer Science Year 2”. Subjects are offered to classes, and
					students belong to one.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<ClassPicker {classes} bind:classId emptyHint="No classes yet — add one below." />

				{#if classId}
					{@const selected = classes.find((c) => c._id === classId)}
					{#if selected}
						<div class="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm">
							<span class="font-semibold">{selected.name}</span>
							<Badge variant="secondary">Year {selected.yearOfStudy}</Badge>
							{#if selected.semesterId}
								<Badge variant="outline">{selected.semesterName}</Badge>
							{:else}
								<Badge class="bg-amber-600 text-white">No semester — subjects cannot be offered</Badge>
							{/if}
							<Button variant="outline" size="sm" class="ml-auto" onclick={() => openEdit(selected)}>
								<Pencil class="size-3.5" /> Edit class
							</Button>
						</div>
					{/if}
				{/if}

				<details class="rounded-md border border-border p-3">
					<summary class="cursor-pointer text-sm font-medium">Add a class</summary>
					<form class="mt-3 grid gap-2 sm:grid-cols-[2fr_1fr_1.5fr_auto]" onsubmit={createClass}>
						<div class="flex flex-col gap-1">
							<Label for="cn">Class name</Label>
							<Input id="cn" bind:value={newClassName} placeholder="e.g. BSc Computer Science Year 2" required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="cy">Year of study</Label>
							<Input id="cy" type="number" min="1" max="10" bind:value={newClassYear} />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="cs">Semester</Label>
							<select id="cs" class="w-full rounded-md border border-input bg-background p-2 text-sm" bind:value={newClassSemester}>
								<option value="">{semesters.length === 0 ? 'Create a semester first' : 'No semester'}</option>
								{#each semesters as s (s._id)}
									<option value={s._id}>{s.name}</option>
								{/each}
							</select>
						</div>
						<div class="flex items-end">
							<Button type="submit" disabled={busy}>Add class</Button>
						</div>
					</form>
				</details>
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<Dialog.Root bind:open={editOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Edit class</Dialog.Title>
			<Dialog.Description>Changes apply immediately to every student in the class.</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-3" onsubmit={saveEdit}>
			<div class="flex flex-col gap-1">
				<Label for="ecn">Class name</Label>
				<Input id="ecn" bind:value={editName} required />
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div class="flex flex-col gap-1">
					<Label for="ecy">Year of study</Label>
					<Input id="ecy" type="number" min="1" max="10" bind:value={editYear} />
				</div>
				<div class="flex flex-col gap-1">
					<Label for="ecs">Semester</Label>
					<select id="ecs" class="w-full rounded-md border border-input bg-background p-2 text-sm" bind:value={editSemester}>
						<option value="">No semester</option>
						{#each semesters as s (s._id)}
							<option value={s._id}>{s.name}</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="mt-2 flex items-center justify-between gap-2">
				<AlertDialog.Root>
					<AlertDialog.Trigger class="text-sm text-red-700 underline" type="button">
						Remove class
					</AlertDialog.Trigger>
					<AlertDialog.Content>
						<AlertDialog.Header>
							<AlertDialog.Title>Remove this class?</AlertDialog.Title>
							<AlertDialog.Description>
								This only works while the class still has subjects. Students are kept and can be moved to
								another class.
							</AlertDialog.Description>
						</AlertDialog.Header>
						<AlertDialog.Footer>
							<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
							<AlertDialog.Action onclick={removeClass}>Remove</AlertDialog.Action>
						</AlertDialog.Footer>
					</AlertDialog.Content>
				</AlertDialog.Root>
				<div class="flex gap-2">
					<Button type="button" variant="outline" onclick={() => (editOpen = false)}>Cancel</Button>
					<Button type="submit" disabled={busy}>Save changes</Button>
				</div>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
