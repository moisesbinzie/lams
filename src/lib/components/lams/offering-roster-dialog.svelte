<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { ProgramRow, Offering, PersonRow } from '$lib/lams/types';
	import { reportError } from '$lib/lams/notify.svelte';

	interface RosterRow {
		personId: string;
		fullName: string;
		regNumber: string;
		status: string;
		addedBy: 'self' | 'rep' | 'lecturer';
	}

	/**
	 * Who is taking this course, and who could join. Program members come first,
	 * then — because a student may sit in several programs or repeat a course
	 * from another program — every other student, searchable by name or reg
	 * number. Assign or withdraw one student at a time; the enrolment this
	 * creates is identical to a self-join.
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
		} catch (err) {
			reportError(err, 'Could not load the roster.');
		} finally {
			loading = false;
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
				students from other programs (e.g. repeats) can be added from the second list.
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
								<span class="block text-xs text-muted-foreground">
									{r.regNumber} · added by {r.addedBy}
								</span>
							</span>
							<Button
								variant="ghost"
								size="sm"
								class="text-red-700"
								disabled={busyId === r.personId}
								onclick={() => assign(r.personId, false)}
							>
								Withdraw
							</Button>
						</li>
					{:else}
						<li class="p-4 text-center text-sm text-muted-foreground">Nobody is enrolled yet.</li>
					{/each}
				</ul>

				{#if filteredProgramCandidates.length > 0}
					<div>
						<p class="mb-1 text-sm font-medium">In {programName}, not taking this course</p>
						<ul class="flex flex-col divide-y divide-border rounded-md border">
							{#each filteredProgramCandidates as c (c._id)}
								<li class="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
									<span>
										{c.fullName}
										<span class="block text-xs text-muted-foreground">{c.regNumber}</span>
									</span>
									<Button variant="outline" size="sm" disabled={busyId === c._id} onclick={() => assign(c._id, true)}>
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
									<span>
										{c.fullName}
										<span class="block text-xs text-muted-foreground">
											{c.regNumber}
											{#if programNamesOf(c)}
												· {programNamesOf(c)}
											{/if}
										</span>
									</span>
									<Button variant="outline" size="sm" disabled={busyId === c._id} onclick={() => assign(c._id, true)}>
										Add
									</Button>
								</li>
							{/each}
						</ul>
					</div>
				{:else if roster.length > 0 && filteredProgramCandidates.length === 0}
					<Badge variant="secondary">Everyone on the roster is already here</Badge>
				{/if}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
