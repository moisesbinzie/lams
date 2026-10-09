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
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Pencil } from '@lucide/svelte';
	import ProgramPicker from './class-picker.svelte';
	import type { ProgramRow, Semester } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';
	import { sessionMe } from '$lib/lams/session.svelte';

	let token = getToken();
	let semesters = $state<Semester[]>([]);
	let programs = $state<ProgramRow[]>([]);
	let programId = $state('');
	let loading = $state(true);
	let busy = $state(false);

	// Academic-year quick setup (admin): Semester 1 & 2 for a calendar year.
	const thisYear = new Date().getFullYear();
	let ayYear = $state(String(thisYear));
	let ayS1Start = $state(`${thisYear}-01-01`);
	let ayS1End = $state(`${thisYear}-06-30`);
	let ayS2Start = $state(`${thisYear}-07-01`);
	let ayS2End = $state(`${thisYear}-12-31`);

	// New program form.
	let newProgramName = $state('');
	let newProgramYears = $state('4');

	// Edit-program dialog.
	let editOpen = $state(false);
	let editId = $state('');
	let editName = $state('');
	let editYears = $state('4');

	const me = $derived(sessionMe());
	const isAdmin = $derived(me?.kind === 'staff' && (me.isAdmin === true || me.role === 'admin'));

	async function loadSemesters() {
		const client = requireConvexClient();
		semesters = (await client.query(api.academics.listSemesters, { token })) as unknown as Semester[];
	}

	async function loadPrograms() {
		const client = requireConvexClient();
		programs = (await client.query(api.academics.listPrograms, { token })) as unknown as ProgramRow[];
	}

	onMount(async () => {
		if (!token) return;
		try {
			await Promise.all([loadSemesters(), loadPrograms()]);
		} catch (err) {
			reportError(err, 'Could not load the setup data.');
		} finally {
			loading = false;
		}
	});

	async function ensureYear(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.academics.ensureAcademicYear, {
				token,
				year: Number(ayYear),
				sem1Start: ayS1Start,
				sem1End: ayS1End,
				sem2Start: ayS2Start,
				sem2End: ayS2End
			})) as { created: string[]; skipped: string[] };
			await loadSemesters();
			if (res.created.length === 0) {
				reportSuccess('Both semesters already exist for that year — nothing to do.');
			} else {
				reportSuccess(
					`${res.created.join(' and ')} created for ${ayYear}.` +
						(res.skipped.length > 0 ? ` ${res.skipped.join(' and ')} already existed.` : ''),
					7000
				);
			}
		} catch (err) {
			reportError(err, 'Could not create the semesters.');
		} finally {
			busy = false;
		}
	}

	async function removeSemester(id: string) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeSemester, { token, id: id as never });
			await Promise.all([loadSemesters(), loadPrograms()]);
			reportSuccess('Semester removed.');
		} catch (err) {
			// The server refuses while offerings still use it.
			reportError(err, 'Could not remove the semester.');
		}
	}

	async function createProgram(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.createProgram, {
				token,
				name: newProgramName.trim(),
				durationYears: Number(newProgramYears)
			});
			newProgramName = '';
			await loadPrograms();
			reportSuccess('Program created. Offer its courses per year in the structure below.', 7000);
		} catch (err) {
			reportError(err, 'Could not create the program.');
		} finally {
			busy = false;
		}
	}

	function openEdit(p: ProgramRow) {
		editId = p._id;
		editName = p.name;
		editYears = String(p.durationYears);
		editOpen = true;
	}

	async function saveEdit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.updateProgram, {
				token,
				id: editId as never,
				name: editName.trim(),
				durationYears: Number(editYears)
			});
			editOpen = false;
			await loadPrograms();
			reportSuccess('Program updated.');
		} catch (err) {
			reportError(err, 'Could not update the program.');
		} finally {
			busy = false;
		}
	}

	async function removeProgram() {
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeProgram, { token, id: editId as never });
			editOpen = false;
			programId = '';
			await loadPrograms();
			reportSuccess('Program removed.');
		} catch (err) {
			reportError(err, 'Could not remove the program.');
		}
	}
</script>

<div class="flex flex-col gap-4">
	{#if loading}
		<div class="flex flex-col gap-2">
			<div class="h-6 w-52 animate-pulse rounded-md bg-muted"></div>
			<div class="h-20 animate-pulse rounded-md bg-muted"></div>
		</div>
	{:else}
		{#if isAdmin}
			<Card.Root class="border-lams-navy/25">
				<Card.Header>
					<Card.Title>Academic year</Card.Title>
					<Card.Description>
						A university year holds two semesters. Create both at once — adjust the dates to your
						calendar first.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<form class="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]" onsubmit={ensureYear}>
						<div class="flex flex-col gap-1">
							<Label for="ayy">Year</Label>
							<Input id="ayy" type="number" min="2000" max="2100" bind:value={ayYear} required />
						</div>
						<DatePicker id="ays1s" label="Semester 1 starts" bind:value={ayS1Start} />
						<DatePicker id="ays1e" label="Semester 1 ends" bind:value={ayS1End} />
						<DatePicker id="ays2s" label="Semester 2 starts" bind:value={ayS2Start} />
						<DatePicker id="ays2e" label="Semester 2 ends" bind:value={ayS2End} />
						<div class="flex items-end sm:col-span-3">
							<Button type="submit" disabled={busy || !ayS1Start || !ayS1End || !ayS2Start || !ayS2End}>
								Create Semester 1 &amp; 2
							</Button>
						</div>
					</form>
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title>Semesters</Card.Title>
				<Card.Description>
					{isAdmin
						? 'Semesters come from the academic year above — one flow, no duplicates.'
						: 'Semesters for the programs you teach in.'}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{#if semesters.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						No semesters yet. {isAdmin ? 'Create the academic year above.' : 'Ask the admin to create one.'}
					</p>
				{:else}
					<ul class="flex flex-col divide-y divide-border">
						{#each semesters as s (s._id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
								<span>
									<strong>{s.name}</strong>
									<span class="text-xs text-muted-foreground">
										· {s.year} · {s.startDate} to {s.endDate}
									</span>
								</span>
								{#if isAdmin}
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
													This only works while no program or course uses the semester.
												</AlertDialog.Description>
											</AlertDialog.Header>
											<AlertDialog.Footer>
												<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
												<AlertDialog.Action onclick={() => removeSemester(s._id)}>Remove</AlertDialog.Action>
											</AlertDialog.Footer>
										</AlertDialog.Content>
									</AlertDialog.Root>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Programs</Card.Title>
				<Card.Description>
					{isAdmin
						? 'A program is a course of study, e.g. “BSc Computer Science”, running several years. Courses change every semester until the final year; students belong to one or more programs.'
						: 'The programs you teach in. Only the admin can create or edit them.'}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<ProgramPicker {programs} bind:programId emptyHint={isAdmin ? 'No programs yet — add one below.' : 'No programs assigned to you yet.'} />

				{#if programId}
					{@const selected = programs.find((c) => c._id === programId)}
					{#if selected}
						<div class="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm">
							<span class="font-semibold">{selected.name}</span>
							<Badge variant="secondary">
								{selected.durationYears} year{selected.durationYears === 1 ? '' : 's'}
							</Badge>
							{#if isAdmin}
								<Button variant="outline" size="sm" class="ml-auto" onclick={() => openEdit(selected)}>
									<Pencil class="size-3.5" /> Edit program
								</Button>
							{/if}
						</div>
					{/if}
				{/if}

				{#if isAdmin}
					<details class="rounded-md border border-border p-3">
					<summary class="cursor-pointer text-sm font-medium">Add a program</summary>
					<form class="mt-3 grid gap-2 sm:grid-cols-[2fr_1fr_auto]" onsubmit={createProgram}>
						<div class="flex flex-col gap-1">
							<Label for="cn">Program name</Label>
							<Input id="cn" bind:value={newProgramName} placeholder="e.g. BSc Computer Science" required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="cy">Years</Label>
							<Input id="cy" type="number" min="1" max="10" bind:value={newProgramYears} />
						</div>
						<div class="flex items-end">
								<Button type="submit" disabled={busy}>Add program</Button>
							</div>
						</form>
					</details>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<Dialog.Root bind:open={editOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Edit program</Dialog.Title>
			<Dialog.Description>Changes apply immediately to every student in the program.</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-3" onsubmit={saveEdit}>
			<div class="flex flex-col gap-1">
				<Label for="ecn">Program name</Label>
				<Input id="ecn" bind:value={editName} required />
			</div>
			<div class="flex flex-col gap-1">
				<Label for="ecy">Years</Label>
				<Input id="ecy" type="number" min="1" max="10" bind:value={editYears} />
			</div>
			<div class="mt-2 flex items-center justify-between gap-2">
				<AlertDialog.Root>
					<AlertDialog.Trigger class="text-sm text-red-700 underline" type="button">
						Remove program
					</AlertDialog.Trigger>
					<AlertDialog.Content>
						<AlertDialog.Header>
							<AlertDialog.Title>Remove this program?</AlertDialog.Title>
							<AlertDialog.Description>
								This only works while the program still has courses. Students are kept and can be moved to
								another program.
							</AlertDialog.Description>
						</AlertDialog.Header>
						<AlertDialog.Footer>
							<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
							<AlertDialog.Action onclick={removeProgram}>Remove</AlertDialog.Action>
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
