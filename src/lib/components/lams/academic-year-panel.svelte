<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import { CalendarRange, Pencil, Plus } from '@lucide/svelte';
	import type { Semester } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';
	import { sessionMe } from '$lib/lams/session.svelte';

	/**
	 * The academic year, and the semesters inside it.
	 *
	 * This is the root of the whole structure — nothing else can be placed
	 * until a semester exists — so it is the first tab and it only ever talks
	 * about years and semesters. Programs, courses and students are elsewhere.
	 *
	 * Two ways in, because universities use both:
	 *   - the common case, Semester 1 and 2 for a year, in one form;
	 *   - a single extra semester (a summer session, number 3), added on its own.
	 */
	let token = getToken();
	let semesters = $state<Semester[]>([]);
	let loading = $state(true);
	let busy = $state(false);
	let activeYear = $state<number | null>(null);
	let usage = $state<Map<string, number>>(new Map());

	const thisYear = new Date().getFullYear();

	// Create a whole year at once (Semesters 1 and 2).
	let batchYear = $state(String(thisYear));
	let s1Start = $state(`${thisYear}-01-01`);
	let s1End = $state(`${thisYear}-06-30`);
	let s2Start = $state(`${thisYear}-07-01`);
	let s2End = $state(`${thisYear}-12-31`);

	// Add one semester on its own (the summer session).
	let showSingle = $state(false);
	let singleYear = $state(String(thisYear));
	let singleNumber = $state('3');
	let singleStart = $state(`${thisYear}-07-01`);
	let singleEnd = $state(`${thisYear}-08-31`);

	// Edit one semester's dates.
	let editOpen = $state(false);
	let editId = $state('');
	let editLabel = $state('');
	let editStart = $state('');
	let editEnd = $state('');

	// Remove confirmation (single semester).
	let removeTarget = $state<Semester | null>(null);
	let removeOpen = $state(false);

	// Remove confirmation (whole year).
	let removeYearTarget = $state<number | null>(null);
	let removeYearOpen = $state(false);

	const me = $derived(sessionMe());
	const isAdmin = $derived(me?.kind === 'staff' && (me.isAdmin === true || me.role === 'admin'));

	/** Newest year first, and inside a year Semester 1, 2, then the summer. */
	const byYear = $derived.by(() => {
		const map = new Map<number, Semester[]>();
		for (const s of [...semesters].sort((a, b) => b.year - a.year || a.number - b.number)) {
			if (!map.has(s.year)) map.set(s.year, []);
			map.get(s.year)!.push(s);
		}
		return [...map.entries()].sort((a, b) => b[0] - a[0]);
	});

	const totalYears = $derived(byYear.length);
	const currentYearHasSemesters = $derived(semesters.some((s) => s.year === Number(batchYear)));

	async function load() {
		const client = requireConvexClient();
		const [sems, active, use] = (await Promise.all([
			client.query(api.academics.listSemesters, { token }),
			client.query(api.academics.getActiveYear, { token }),
			client.query(api.academics.semesterUsage, { token })
		])) as unknown as [Semester[], { activeYear: number | null }, { semesterId: string; placements: number }[]];
		semesters = sems;
		activeYear = active.activeYear;
		usage = new Map(use.map((u) => [u.semesterId, u.placements]));
	}

	function placementsIn(id: string): number {
		return usage.get(id) ?? 0;
	}

	onMount(async () => {
		if (!token) {
			loading = false;
			return;
		}
		try {
			await load();
		} catch (err) {
			reportError(err, 'Could not load the academic years.');
		} finally {
			loading = false;
		}
	});

	async function createYear(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.academics.ensureAcademicYear, {
				token,
				year: Number(batchYear),
				sem1Start: s1Start,
				sem1End: s1End,
				sem2Start: s2Start,
				sem2End: s2End
			})) as { created: string[]; skipped: string[] };
			await load();
			if (res.created.length === 0) {
				reportSuccess(`Both semesters already exist for ${batchYear} — nothing to do.`);
			} else {
				reportSuccess(
					`${res.created.join(' and ')} created for ${batchYear}.` +
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

	async function createSingle(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.academics.createSemester, {
				token,
				year: Number(singleYear),
				number: Number(singleNumber),
				startDate: singleStart,
				endDate: singleEnd
			})) as { name: string };
			await load();
			showSingle = false;
			reportSuccess(`${res.name} added for ${singleYear}.`, 7000);
		} catch (err) {
			reportError(err, 'Could not add that semester.');
		} finally {
			busy = false;
		}
	}

	function openEdit(s: Semester) {
		editId = s._id;
		editLabel = `${s.name} · ${s.year}`;
		editStart = s.startDate;
		editEnd = s.endDate;
		editOpen = true;
	}

	async function saveEdit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.updateSemester, {
				token,
				id: editId as never,
				startDate: editStart,
				endDate: editEnd
			});
			editOpen = false;
			await load();
			reportSuccess('Semester dates updated.');
		} catch (err) {
			reportError(err, 'Could not update those dates.');
		} finally {
			busy = false;
		}
	}

	async function removeSemesterConfirmed() {
		if (!removeTarget) return;
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeSemester, { token, id: removeTarget._id as never });
			await load();
			reportSuccess(`${removeTarget.name} ${removeTarget.year} removed.`);
		} catch (err) {
			// The server refuses while courses are still placed in it, and says so.
			reportError(err, 'Could not remove that semester.');
		} finally {
			busy = false;
			removeOpen = false;
		}
	}

	async function setActive(year: number) {
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.setActiveYear, { token, year });
			await load();
			reportSuccess(`${year} is now the active year. New courses and slots default to its semesters.`);
		} catch (err) {
			reportError(err, 'Could not set the active year.');
		} finally {
			busy = false;
		}
	}

	async function removeYearConfirmed() {
		if (removeYearTarget === null) return;
		busy = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.academics.removeAcademicYear, {
				token,
				year: removeYearTarget
			})) as { removed: number };
			await load();
			reportSuccess(`Academic year ${removeYearTarget} removed (${res.removed} semesters).`);
		} catch (err) {
			reportError(err, 'Could not remove that year.');
		} finally {
			busy = false;
			removeYearOpen = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	{#if loading}
		<div class="flex flex-col gap-2">
			<div class="h-6 w-52 animate-pulse rounded-md bg-muted"></div>
			<div class="h-24 animate-pulse rounded-md bg-muted"></div>
		</div>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex flex-wrap items-center gap-2">
					Academic years
					{#if totalYears > 0}
						<Badge variant="secondary">{totalYears} year{totalYears === 1 ? '' : 's'}</Badge>
					{/if}
				</Card.Title>
			<Card.Description>
				A university year holds its semesters. Everything else in the system hangs off a
				semester: courses are placed into one, and lectures are recorded against one. The
				active year drives default pickers in Programs and Timetable.
			</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				{#if byYear.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						{isAdmin
							? 'No academic years yet. Create the first one below — it is step one of the whole setup.'
							: 'No semesters yet. Ask an admin to create the academic year.'}
					</p>
				{:else}
				{#each byYear as [year, list] (year)}
					<details open class="rounded-lg border border-border">
						<summary class="cursor-pointer list-none px-4 py-2.5 [&::-webkit-details-marker]:hidden">
							<span class="flex flex-wrap items-center gap-2">
								<CalendarRange class="size-4 text-lams-navy" aria-hidden="true" />
								<span class="text-sm font-bold text-lams-navy">Academic year {year}</span>
								<Badge variant="outline">
									{list.length} semester{list.length === 1 ? '' : 's'}
								</Badge>
								{#if activeYear === year}
									<Badge class="bg-lams-navy text-white">Active</Badge>
								{/if}
								{#if year === thisYear && activeYear !== year}
									<Badge class="bg-lams-green text-white">Current</Badge>
								{/if}
							</span>
						</summary>
						{#if isAdmin}
							<div class="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2">
								{#if activeYear !== year}
									<Button size="sm" variant="outline" disabled={busy} onclick={() => setActive(year)}>
										Set as active year
									</Button>
								{:else}
									<span class="text-xs text-muted-foreground">
										Defaults in Programs and Timetable use this year.
									</span>
								{/if}
								<Button
									size="sm"
									variant="ghost"
									class="ml-auto text-red-700"
									disabled={busy}
									onclick={() => {
										removeYearTarget = year;
										removeYearOpen = true;
									}}
								>
									Remove year
								</Button>
							</div>
						{/if}
						<ul class="flex flex-col divide-y divide-border border-t border-border px-4">
							{#each list as s (s._id)}
								<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
									<span class="flex flex-wrap items-center gap-2">
										<strong>{s.name}</strong>
										{#if s.number === 3}
											<Badge variant="outline">Summer session</Badge>
										{/if}
										<span class="text-xs text-muted-foreground">{s.startDate} → {s.endDate}</span>
										{#if placementsIn(s._id) > 0}
											<Badge variant="secondary">{placementsIn(s._id)} placed</Badge>
										{/if}
									</span>
										{#if isAdmin}
											<div class="flex items-center gap-1">
												<Button variant="ghost" size="sm" onclick={() => openEdit(s)}>
													<Pencil class="size-3.5" aria-hidden="true" /> Dates
												</Button>
												<Button
													variant="ghost"
													size="sm"
													class="text-red-700"
													onclick={() => {
														removeTarget = s;
														removeOpen = true;
													}}
												>
													Remove
												</Button>
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						</details>
					{/each}
				{/if}
			</Card.Content>
		</Card.Root>

		{#if isAdmin}
			<Card.Root class="border-lams-navy/25">
				<Card.Header>
					<Card.Title>Create an academic year</Card.Title>
					<Card.Description>
						Creates Semester 1 and Semester 2 together. Running it twice is safe — a semester
						that already exists is left alone.
					</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-col gap-4">
					<form class="flex flex-col gap-3" onsubmit={createYear}>
						<div class="flex flex-col gap-1 sm:max-w-40">
							<Label for="ay-year">Year</Label>
							<Input id="ay-year" type="number" min="2000" max="2100" bind:value={batchYear} required />
						</div>
						<div class="grid gap-3 sm:grid-cols-2">
							<div class="flex flex-col gap-2 rounded-md border border-border p-3">
								<span class="text-sm font-semibold">Semester 1</span>
								<DatePicker id="ay-s1s" label="Starts" bind:value={s1Start} />
								<DatePicker id="ay-s1e" label="Ends" bind:value={s1End} />
							</div>
							<div class="flex flex-col gap-2 rounded-md border border-border p-3">
								<span class="text-sm font-semibold">Semester 2</span>
								<DatePicker id="ay-s2s" label="Starts" bind:value={s2Start} />
								<DatePicker id="ay-s2e" label="Ends" bind:value={s2End} />
							</div>
						</div>
						<div class="flex flex-wrap items-center gap-3">
							<Button type="submit" disabled={busy || !s1Start || !s1End || !s2Start || !s2End}>
								{busy ? 'Creating…' : 'Create Semester 1 & 2'}
							</Button>
							{#if currentYearHasSemesters}
								<span class="text-xs text-muted-foreground">
									{batchYear} already has semesters — any that exist will be skipped.
								</span>
							{/if}
						</div>
					</form>

					<div class="border-t border-border pt-4">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div>
								<p class="text-sm font-medium">Add a single semester</p>
								<p class="text-xs text-muted-foreground">
									For a summer session (number 3) or a year being filled in one half at a time.
								</p>
							</div>
							<Button
								size="sm"
								variant={showSingle ? 'outline' : 'secondary'}
								onclick={() => (showSingle = !showSingle)}
							>
								{#if showSingle}
									Close
								{:else}
									<Plus class="size-3.5" aria-hidden="true" /> Add one semester
								{/if}
							</Button>
						</div>
						{#if showSingle}
							<form class="mt-3 grid gap-3 sm:grid-cols-4" onsubmit={createSingle}>
								<div class="flex flex-col gap-1">
									<Label for="ay-sy">Year</Label>
									<Input id="ay-sy" type="number" min="2000" max="2100" bind:value={singleYear} required />
								</div>
								<div class="flex flex-col gap-1">
									<Label for="ay-sn">Semester</Label>
									<Input id="ay-sn" type="number" min="1" max="3" bind:value={singleNumber} required />
									<span class="text-xs text-muted-foreground">1, 2 or 3 (summer)</span>
								</div>
								<DatePicker id="ay-ss" label="Starts" bind:value={singleStart} />
								<DatePicker id="ay-se" label="Ends" bind:value={singleEnd} />
								<div class="sm:col-span-4">
									<Button type="submit" disabled={busy || !singleStart || !singleEnd}>
										{busy ? 'Adding…' : 'Add semester'}
									</Button>
								</div>
							</form>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>

<Dialog.Root bind:open={editOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Dates for {editLabel}</Dialog.Title>
			<Dialog.Description>
				Only the dates change. The year and number are what courses and lecture records are
				already filed under, so those stay put.
			</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-3" onsubmit={saveEdit}>
			<DatePicker id="se-start" label="Starts" bind:value={editStart} />
			<DatePicker id="se-end" label="Ends" bind:value={editEnd} />
			<div class="flex justify-end gap-2">
				<Button type="button" variant="outline" onclick={() => (editOpen = false)}>Cancel</Button>
				<Button type="submit" disabled={busy || !editStart || !editEnd}>
					{busy ? 'Saving…' : 'Save dates'}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={removeOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove {removeTarget?.name} {removeTarget?.year}?</AlertDialog.Title>
			<AlertDialog.Description>
				This only works while no course is placed in it and no lecture has been recorded. Courses
				and lecture records are kept as history.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={removeSemesterConfirmed}>Remove</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={removeYearOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove academic year {removeYearTarget}?</AlertDialog.Title>
			<AlertDialog.Description>
				Removes every semester in {removeYearTarget}. This only works while no courses are
				placed in any of them and no lectures were recorded. If it was the active year, the
				active mark is cleared.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={removeYearConfirmed}>Remove year</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
