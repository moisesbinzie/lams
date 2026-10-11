<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { UserMinus } from '@lucide/svelte';
	import type { ProgramRow, Offering, PersonRow } from '$lib/lams/types';
	import { parseRosterCsv } from '$lib/lams/csv';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	interface RosterRow {
		personId: string;
		fullName: string;
		regNumber: string;
		studentId: string;
		status: string;
		addedBy: 'self' | 'rep' | 'lecturer';
	}

	/**
	 * Who is taking this course, and who could join. Program members come first,
	 * then — because a student may sit in several programs or repeat a course
	 * from another program — every other student, searchable by name or reg
	 * number. Tick several and add them together (`assignManyForOffering`), or
	 * paste a class list to register brand-new students straight in
	 * (`registerManyAndEnrol`); the enrolment this creates is identical to a
	 * self-join.
	 */
	let {
		offering,
		programs,
		token,
		open = $bindable(false),
		onchanged
	}: {
		offering: Offering | null;
		programs: ProgramRow[];
		token: string;
		open?: boolean;
		onchanged?: () => void | Promise<void>;
	} = $props();

	let roster = $state<RosterRow[]>([]);
	let programCandidates = $state<PersonRow[]>([]);
	let otherCandidates = $state<PersonRow[]>([]);
	let search = $state('');
	let loading = $state(false);
	let busyId = $state('');
	/** Tick-box selection across both candidate lists for one-tap bulk add. */
	let selectedIds = $state<Set<string>>(new Set());
	let addingMany = $state(false);
	/** Pasted "Full Name, Reg Number, Student ID" lines for bulk registration. */
	let bulkText = $state('');
	let registeringMany = $state(false);

	const programName = $derived(
		programs.find((c) => c._id === offering?.programId)?.name ?? offering?.programName ?? 'this program'
	);
	const filteredRoster = $derived(
		roster.filter((r) => {
			const q = search.trim().toLowerCase();
			return !q || r.fullName.toLowerCase().includes(q) || r.regNumber.toLowerCase().includes(q);
		})
	);
	const filteredProgramCandidates = $derived(filterCandidates(programCandidates));
	const filteredOtherCandidates = $derived(filterCandidates(otherCandidates));
	/** Every addable student currently visible across both lists. */
	const allVisibleAddable = $derived([...filteredProgramCandidates, ...filteredOtherCandidates]);
	const allVisibleSelected = $derived(
		allVisibleAddable.length > 0 && allVisibleAddable.every((c) => selectedIds.has(String(c._id)))
	);
	/** Usable pasted lines for the bulk-register box, so the button can show its count. */
	const bulkRows = $derived(parseRosterCsv(bulkText));

	function filterCandidates(list: PersonRow[]): PersonRow[] {
		const q = search.trim().toLowerCase();
		return list.filter(
			(c) => !q || c.fullName.toLowerCase().includes(q) || c.regNumber.toLowerCase().includes(q)
		);
	}

	function programNamesOf(person: PersonRow): string {
		return person.programIds
			.map((id) => programs.find((c) => c._id === id)?.name)
			.filter(Boolean)
			.join(', ');
	}

	$effect(() => {
		if (open && offering) void load();
	});

	async function load() {
		if (!offering) return;
		loading = true;
		try {
			const client = requireConvexClient();
			const [enrolled, everyone] = (await Promise.all([
				client.query(api.enrolments.listForOffering, { token, offeringId: offering._id as never }),
				client.query(api.people.listPeople, { token })
			])) as [RosterRow[], PersonRow[]];
			roster = enrolled;
			const enrolledIds = new Set(enrolled.map((r) => r.personId));
			const available = everyone.filter(
				(m) => !enrolledIds.has(m._id) && m.status !== 'blocked'
			);
			const pid = offering.programId;
			programCandidates = pid ? available.filter((m) => m.programIds.includes(pid)) : [];
			otherCandidates = available
				.filter((m) => pid === null || !m.programIds.includes(pid))
				.sort((a, b) => a.fullName.localeCompare(b.fullName));
			// Drop ticks for anyone who just landed in the course elsewhere.
			const stillAddable = new Set(available.map((m) => String(m._id)));
			selectedIds = new Set([...selectedIds].filter((id) => stillAddable.has(id)));
		} catch (err) {
			reportError(err, 'Could not load the roster.');
		} finally {
			loading = false;
		}
	}

	function toggleOne(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	}

	function toggleAllVisible() {
		if (allVisibleSelected) selectedIds = new Set();
		else selectedIds = new Set(allVisibleAddable.map((c) => String(c._id)));
	}

	async function addSelected() {
		if (!offering || selectedIds.size === 0) return;
		addingMany = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.enrolments.assignManyForOffering, {
				token,
				offeringId: offering._id as never,
				personIds: [...selectedIds] as never[],
				enroll: true
			})) as { added: number; removed: number; unchanged: number };
			selectedIds = new Set();
			await load();
			await onchanged?.();
			reportSuccess(
				`${res.added} student${res.added === 1 ? '' : 's'} added to ${offering.courseCode}.` +
					(res.unchanged > 0 ? ` ${res.unchanged} already had it.` : '')
			);
		} catch (err) {
			reportError(err, 'Could not add those students.');
		} finally {
			addingMany = false;
		}
	}

	/**
	 * Paste a class list — one "Full Name, Reg Number, Student ID" per line —
	 * and register every line straight into this course. Duplicates and
	 * incomplete lines are skipped with a count, never fatal.
	 */
	async function registerMany() {
		const rows = parseRosterCsv(bulkText);
		if (rows.length === 0) {
			reportError(
				new Error('No usable lines.'),
				'Use one per line: Full Name, Registration Number, Student ID.'
			);
			return;
		}
		if (!offering) return;
		registeringMany = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.people.registerManyAndEnrol, {
				token,
				offeringId: offering._id as never,
				rows
			})) as { added: number; skipped: number };
			bulkText = '';
			await load();
			await onchanged?.();
			reportSuccess(
				`Registered ${res.added} student${res.added === 1 ? '' : 's'} into ${offering.courseCode}.` +
					(res.skipped > 0 ? ` ${res.skipped} skipped as duplicates or incomplete.` : '')
			);
		} catch (err) {
			reportError(err, 'Could not register those students.');
		} finally {
			registeringMany = false;
		}
	}

	async function assign(personId: string, enroll: boolean) {
		if (!offering) return;
		busyId = personId;
		try {
			const client = requireConvexClient();
			await client.mutation(api.enrolments.assignForPerson, {
				token,
				personId: personId as never,
				offeringId: offering._id as never,
				enroll
			});
			const next = new Set(selectedIds);
			next.delete(String(personId));
			selectedIds = next;
			await load();
			await onchanged?.();
		} catch (err) {
			reportError(err, 'Could not change the enrolment.');
		} finally {
			busyId = '';
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Roster — {offering?.courseCode}</Dialog.Title>
			<Dialog.Description>
				{roster.length} student(s) taking this course. Everyone in {programName} is listed first;
				students from other programs (e.g. repeats) can be added from the second list. Tick
				several and add them together, or paste a class list below to register new ones.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-3">
			<Input bind:value={search} placeholder="Search by name or reg number" aria-label="Search roster" />
			{#if loading}
				<div class="h-24 animate-pulse rounded-md bg-muted"></div>
			{:else}
				<ul class="flex flex-col divide-y divide-border rounded-md border">
				{#each filteredRoster as r (r.personId)}
					<li class="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
						<span>
							<strong>{r.fullName}</strong>
							<span class="block font-mono text-xs text-muted-foreground">
								{r.regNumber} · {r.studentId} · added by {r.addedBy}
							</span>
						</span>
						<Button
							variant="ghost"
							size="icon-sm"
							class="text-red-700"
							title={`Withdraw ${r.fullName} from this course`}
							aria-label={`Withdraw ${r.fullName} from this course`}
							disabled={busyId === r.personId}
							onclick={() => assign(r.personId, false)}
						>
							<UserMinus class="size-3.5" aria-hidden="true" />
						</Button>
					</li>
				{:else}
						<li class="p-4 text-center text-sm text-muted-foreground">Nobody is enrolled yet.</li>
					{/each}
				</ul>

				{#if allVisibleAddable.length > 0}
					<div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 p-2">
						<label class="flex cursor-pointer items-center gap-2 text-xs font-medium">
							<Checkbox
								checked={allVisibleSelected}
								onCheckedChange={toggleAllVisible}
								aria-label="Select all visible students"
							/>
							Select all visible ({allVisibleAddable.length})
							{#if selectedIds.size > 0}
								<span class="text-muted-foreground">· {selectedIds.size} ticked</span>
							{/if}
						</label>
						<Button size="sm" disabled={selectedIds.size === 0 || addingMany} onclick={addSelected}>
							{addingMany ? 'Adding…' : `Add selected (${selectedIds.size})`}
						</Button>
					</div>
				{/if}

				{#if filteredProgramCandidates.length > 0}
					<div>
						<p class="mb-1 text-sm font-medium">In {programName}, not taking this course</p>
						<ul class="flex flex-col divide-y divide-border rounded-md border">
							{#each filteredProgramCandidates as c (c._id)}
							<li class="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
								<span class="flex items-start gap-2">
									<Checkbox
										id={`roster-add-${c._id}`}
										checked={selectedIds.has(String(c._id))}
										onCheckedChange={() => toggleOne(String(c._id))}
										aria-label={`Select ${c.fullName}`}
										class="mt-1"
									/>
									<span>
										<label for={`roster-add-${c._id}`} class="cursor-pointer">{c.fullName}</label>
										<span class="block font-mono text-xs text-muted-foreground">
											{c.regNumber} · {c.studentId}
										</span>
									</span>
								</span>
								<Button variant="outline" size="sm" disabled={busyId === c._id || addingMany} onclick={() => assign(c._id, true)}>
									Add
								</Button>
							</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if filteredOtherCandidates.length > 0}
					<div>
						<p class="mb-1 text-sm font-medium">From other programs</p>
						<p class="mb-1 text-xs text-muted-foreground">
							Repeating a subject or sitting in with another cohort — adding them here is the same as
							them joining themselves.
						</p>
						<ul class="flex flex-col divide-y divide-border rounded-md border">
							{#each filteredOtherCandidates as c (c._id)}
							<li class="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
								<span class="flex items-start gap-2">
									<Checkbox
										id={`roster-add-${c._id}`}
										checked={selectedIds.has(String(c._id))}
										onCheckedChange={() => toggleOne(String(c._id))}
										aria-label={`Select ${c.fullName}`}
										class="mt-1"
									/>
									<span>
										<label for={`roster-add-${c._id}`} class="cursor-pointer">{c.fullName}</label>
										<span class="block text-xs text-muted-foreground">
											<span class="font-mono">{c.regNumber} · {c.studentId}</span>
											{#if programNamesOf(c)}
												· {programNamesOf(c)}
											{/if}
										</span>
									</span>
								</span>
									<Button variant="outline" size="sm" disabled={busyId === c._id || addingMany} onclick={() => assign(c._id, true)}>
										Add
									</Button>
								</li>
							{/each}
						</ul>
					</div>
				{:else if roster.length > 0 && filteredProgramCandidates.length === 0 && allVisibleAddable.length === 0}
					<Badge variant="secondary">Everyone on the roster is already here</Badge>
				{/if}

				<div class="flex flex-col gap-2 border-t border-border pt-3">
					<Label for="roster-bulk">Or register many at once — one per line</Label>
					<Textarea
						id="roster-bulk"
						class="min-h-20"
						bind:value={bulkText}
						placeholder={'Amina Banda, BIT/2024/0123, 2024-0123\nJohn Phiri, BIT/2024/0124, 2024-0124'}
					/>
					<div>
						<Button
							variant="secondary"
							size="sm"
							disabled={registeringMany || bulkRows.length === 0}
							onclick={registerMany}
						>
							{registeringMany ? 'Registering…' : `Register + add these (${bulkRows.length})`}
						</Button>
					</div>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
