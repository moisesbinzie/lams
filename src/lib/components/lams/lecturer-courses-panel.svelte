<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Table from '$lib/components/ui/table';
	import { BookOpen, Plus, Search, UserPlus, UserMinus, UserRoundCheck } from '@lucide/svelte';
	import type { Meeting, Offering, ProgramRow, WithdrawnRosterEntry, JoinRequest } from '$lib/lams/types';
	import { parseRosterCsv } from '$lib/lams/csv';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	/**
	 * The Lectures hub: a lecturer's own courses, who is taking each one,
	 * and the roster tools for that course — all in one place.
	 *
	 * Course-first on purpose. The question a lecturer asks is always "who is
	 * in *this* course?", never "what is this student taking?" (that is the
	 * Students tab in the admin setup console). So the course list is the
	 * picker, and everything below follows the selected course.
	 *
	 * Adding is `assignForPerson` (enroll true) for one student or
	 * `assignManyForOffering` for a ticked set — a withdrawal, never a delete,
	 * so attendance history is kept. Registering brand-new students is
	 * `registerAndEnrol` (one) or `registerManyAndEnrol` (pasted list): the
	 * student joins the course's program and the course together, so the
	 * admin's Students tab always sees the full chain. Any enrolled
	 * student can also be made a program rep (`setRep`) for the course's
	 * program — the same grant the Students tab offers.
	 */
	let token = getToken();
	let offerings = $state<Offering[]>([]);
	let programs = $state<ProgramRow[]>([]);
	let selectedId = $state('');
	let roster = $state<
		{
			_id: string;
			personId: string;
			fullName: string;
			regNumber: string;
			studentId: string;
			status: string;
			addedBy: 'self' | 'rep' | 'lecturer';
		}[]
	>([]);
	let meetings = $state<Meeting[]>([]);
	/** Person ids currently representing the selected course's program. */
	let repIds = $state<Set<string>>(new Set());
	/** Students automatically withdrawn from the selected course (4 consecutive absences). */
	let withdrawnRoster = $state<WithdrawnRosterEntry[]>([]);
	/** Pending requests to join the selected course from outside its programmes. */
	let joinRequests = $state<JoinRequest[]>([]);
	let loading = $state(true);
	let rosterLoading = $state(false);

	let rosterSearch = $state('');
	let addSearch = $state('');
	let candidates = $state<
		{
			_id: string;
			fullName: string;
			regNumber: string;
			studentId: string;
			programIds: string[];
		}[]
	>([]);
	let searching = $state(false);
	let searched = $state(false);

	let showRegister = $state(false);
	let newName = $state('');
	let newReg = $state('');
	let newSid = $state('');
	let busyId = $state('');
	let registering = $state(false);
	/** Pasted "Full Name, Reg Number, Student ID" lines for bulk registration. */
	let bulkRegisterText = $state('');
	let registeringMany = $state(false);
	/** Tick-box selection across the search results for one-tap bulk add. */
	let selectedToAdd = $state<Set<string>>(new Set());
	let addingMany = $state(false);
	let togglingOpen = $state(false);
	let openingAll = $state(false);

	const selected = $derived(offerings.find((o) => o._id === selectedId) ?? null);
	/** Courses still closed to self-enrolment — one tap below opens all of them. */
	const closedOfferings = $derived(offerings.filter((o) => !o.openForEnrolment));
	const programNameById = $derived(new Map(programs.map((p) => [p._id, p.name])));
	const enrolledIds = $derived(new Set(roster.map((r) => String(r.personId))));

	const filteredRoster = $derived(
		roster
			.filter((r) => {
				const q = rosterSearch.trim().toLowerCase();
				if (!q) return true;
				return (
					r.fullName.toLowerCase().includes(q) ||
					r.regNumber.toLowerCase().includes(q) ||
					(r.studentId ?? '').toLowerCase().includes(q)
				);
			})
			.sort((a, b) => a.fullName.localeCompare(b.fullName))
	);

	const addable = $derived(candidates.filter((c) => !enrolledIds.has(String(c._id))));
	/** Usable pasted lines for the bulk-register box, so the button can show its count. */
	const bulkRegisterRows = $derived(parseRosterCsv(bulkRegisterText));
	const allAddableSelected = $derived(
		addable.length > 0 && addable.every((c) => selectedToAdd.has(String(c._id)))
	);

	function programNamesOf(ids: string[]): string {
		const names = ids
			.map((id) => programNameById.get(id))
			.filter((n): n is string => Boolean(n));
		return names.join(', ');
	}

	onMount(() => {
		void load();
	});

	async function load() {
		if (!token) {
			loading = false;
			return;
		}
		loading = true;
		try {
			const client = requireConvexClient();
			const [offs, progs] = (await Promise.all([
				client.query(api.academics.listOfferings, { token }),
				client.query(api.academics.listPrograms, { token })
			])) as [Offering[], ProgramRow[]];
			offerings = [...offs].sort((a, b) => a.courseCode.localeCompare(b.courseCode));
			programs = progs;
			if (!selectedId || !offerings.some((o) => o._id === selectedId)) {
				selectedId = offerings[0]?._id ?? '';
			}
			await loadRoster();
		} catch (err) {
			reportError(err, 'Could not load your courses.');
		} finally {
			loading = false;
		}
	}

	async function loadRoster() {
		if (!token || !selectedId) {
			roster = [];
			meetings = [];
			repIds = new Set();
			withdrawnRoster = [];
			joinRequests = [];
			return;
		}
		const offering = offerings.find((o) => o._id === selectedId) ?? null;
		rosterLoading = true;
		try {
			const client = requireConvexClient();
			const [rows, slots, reps, gone, requests] = (await Promise.all([
				client.query(api.enrolments.listForOffering, {
					token,
					offeringId: selectedId as never
				}),
				client.query(api.timetable.listForOffering, {
					token,
					offeringId: selectedId as never
				}),
				offering?.programId
					? client.query(api.reps.listForProgram, {
							token,
							programId: offering.programId as never
						})
					: Promise.resolve([]),
				client.query(api.enrolments.listWithdrawnForOffering, {
					token,
					offeringId: selectedId as never
				}),
				client.query(api.enrolments.listJoinRequests, {
					token,
					offeringId: selectedId as never
				})
			])) as [
				{
					_id: string;
					personId: string;
					fullName: string;
					regNumber: string;
					studentId: string;
					status: string;
					addedBy: 'self' | 'rep' | 'lecturer';
				}[],
				Meeting[],
				{ personId: string }[],
				WithdrawnRosterEntry[],
				JoinRequest[]
			];
			roster = rows;
			meetings = slots;
			repIds = new Set(reps.map((r) => String(r.personId)));
			withdrawnRoster = gone;
			joinRequests = requests;
		} catch (err) {
			reportError(err, 'Could not load that course.');
		} finally {
			rosterLoading = false;
		}
	}

	function select(id: string) {
		if (id === selectedId) return;
		selectedId = id;
		rosterSearch = '';
		addSearch = '';
		candidates = [];
		searched = false;
		showRegister = false;
		bulkRegisterText = '';
		selectedToAdd = new Set();
		void loadRoster();
	}

	async function searchAll(e?: SubmitEvent) {
		e?.preventDefault();
		if (!token || addSearch.trim().length < 2) {
			candidates = [];
			searched = false;
			return;
		}
		searching = true;
		try {
			const client = requireConvexClient();
			candidates = (await client.query(api.people.searchPeople, {
				token,
				q: addSearch.trim()
			})) as typeof candidates;
			searched = true;
			// Drop ticks for anyone who just landed in the course elsewhere.
			const stillAddable = new Set(
				candidates
					.filter((c) => !enrolledIds.has(String(c._id)))
					.map((c) => String(c._id))
			);
			selectedToAdd = new Set([...selectedToAdd].filter((id) => stillAddable.has(id)));
		} catch (err) {
			reportError(err, 'Could not search students.');
		} finally {
			searching = false;
		}
	}

	function toggleSelect(id: string) {
		const next = new Set(selectedToAdd);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedToAdd = next;
	}

	function toggleSelectAll() {
		if (allAddableSelected) selectedToAdd = new Set();
		else selectedToAdd = new Set(addable.map((c) => String(c._id)));
	}

	async function addSelected() {
		if (!token || !selectedId || selectedToAdd.size === 0) return;
		addingMany = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.enrolments.assignManyForOffering, {
				token,
				offeringId: selectedId as never,
				personIds: [...selectedToAdd] as never[],
				enroll: true
			})) as { added: number; removed: number; unchanged: number };
			selectedToAdd = new Set();
			candidates = [];
			searched = false;
			addSearch = '';
			await loadRoster();
			await refreshCounts();
			reportSuccess(
				`${res.added} student${res.added === 1 ? '' : 's'} added to ${selected?.courseCode ?? 'the course'}.` +
					(res.unchanged > 0 ? ` ${res.unchanged} already had it.` : '')
			);
		} catch (err) {
			reportError(err, 'Could not add those students.');
		} finally {
			addingMany = false;
		}
	}

	async function addExisting(personId: string, fullName: string) {
		if (!token || !selectedId) return;
		busyId = personId;
		try {
			const client = requireConvexClient();
			await client.mutation(api.enrolments.assignForPerson, {
				token,
				personId: personId as never,
				offeringId: selectedId as never,
				enroll: true
			});
			candidates = candidates.filter((c) => String(c._id) !== String(personId));
			const next = new Set(selectedToAdd);
			next.delete(String(personId));
			selectedToAdd = next;
			await loadRoster();
			await refreshCounts();
			reportSuccess(`${fullName} added to ${selected?.courseCode ?? 'the course'}.`);
		} catch (err) {
			reportError(err, 'Could not add that student.');
		} finally {
			busyId = '';
		}
	}

	/**
	 * Make or remove a program rep for the selected course's program. A rep
	 * takes attendance for everything their program takes, so this is scoped
	 * to the program — not the course — exactly like the Students tab.
	 */
	async function toggleRep(personId: string, fullName: string) {
		if (!token || !selected?.programId) return;
		const isRep = repIds.has(String(personId));
		busyId = personId;
		try {
			await requireConvexClient().mutation(api.reps.setRep, {
				token,
				programId: selected.programId as never,
				personId: personId as never,
				isRep: !isRep
			});
			await loadRoster();
			reportSuccess(
				isRep
					? `${fullName} is no longer a program rep.`
					: `${fullName} can now take attendance for everything ${selected.programName} takes.`
			);
		} catch (err) {
			reportError(err, 'Could not change that.');
		} finally {
			busyId = '';
		}
	}

	async function withdraw(personId: string, fullName: string) {
		if (!token || !selectedId) return;
		if (
			!confirm(
				`Withdraw ${fullName} from ${selected?.courseCode ?? 'this course'}? Attendance already recorded is kept.`
			)
		) {
			return;
		}
		busyId = personId;
		try {
			const client = requireConvexClient();
			await client.mutation(api.enrolments.assignForPerson, {
				token,
				personId: personId as never,
				offeringId: selectedId as never,
				enroll: false
			});
			await loadRoster();
			await refreshCounts();
			reportSuccess(`${fullName} withdrawn. Their past records are kept.`);
		} catch (err) {
			reportError(err, 'Could not withdraw that student.');
		} finally {
			busyId = '';
		}
	}

	async function decideRequest(requestId: string, fullName: string, approve: boolean) {
		if (!token) return;
		if (!confirm(`${approve ? 'Admit' : 'Reject'} ${fullName} ${approve ? 'into' : 'from'} ${selected?.courseCode ?? 'this course'}?`)) {
			return;
		}
		busyId = requestId;
		try {
			const client = requireConvexClient();
			await client.mutation(api.enrolments.decideJoinRequest, {
				token,
				requestId: requestId as never,
				approve
			});
			await loadRoster();
			await refreshCounts();
			reportSuccess(
				approve
					? `${fullName} admitted to ${selected?.courseCode ?? 'the course'}.`
					: `${fullName}'s request was rejected.`
			);
		} catch (err) {
			reportError(err, 'Could not decide that request.');
		} finally {
			busyId = '';
		}
	}

	async function registerAndEnrol(e: SubmitEvent) {		e.preventDefault();
		if (!token || !selected) return;
		if (!selected.programId) {
			reportError(
				new Error('No program.'),
				'This course has no program yet — ask the admin to place it first.'
			);
			return;
		}
		registering = true;
		try {
			const client = requireConvexClient();
			// One call: the student joins the course's program and the course
			// together, so the admin's Students tab always sees the full
			// chain — program, course, semester and year — never half of it.
			await client.mutation(api.people.registerAndEnrol, {
				token,
				fullName: newName.trim(),
				regNumber: newReg.trim(),
				studentId: newSid.trim(),
				offeringId: selected._id as never
			});
			newName = '';
			newReg = '';
			newSid = '';
			showRegister = false;
			await loadRoster();
			await refreshCounts();
			reportSuccess('Student registered and added to this course.');
		} catch (err) {
			reportError(err, 'Could not register that student.');
		} finally {
			registering = false;
		}
	}

	/**
	 * Paste a class list — one "Full Name, Reg Number, Student ID" per line —
	 * and register every line straight into this course. Duplicates and
	 * incomplete lines are skipped with a count, never fatal.
	 */
	async function registerMany() {
		const rows = parseRosterCsv(bulkRegisterText);
		if (rows.length === 0) {
			reportError(
				new Error('No usable lines.'),
				'Use one per line: Full Name, Registration Number, Student ID.'
			);
			return;
		}
		if (!token || !selected) return;
		if (!selected.programId) {
			reportError(
				new Error('No program.'),
				'This course has no program yet — ask the admin to place it first.'
			);
			return;
		}
		registeringMany = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.people.registerManyAndEnrol, {
				token,
				offeringId: selected._id as never,
				rows
			})) as { added: number; skipped: number };
			bulkRegisterText = '';
			await loadRoster();
			await refreshCounts();
			reportSuccess(
				`Registered ${res.added} student${res.added === 1 ? '' : 's'} into ${selected.courseCode}.` +
					(res.skipped > 0 ? ` ${res.skipped} skipped as duplicates or incomplete.` : '')
			);
		} catch (err) {
			reportError(err, 'Could not register those students.');
		} finally {
			registeringMany = false;
		}
	}

	async function refreshCounts() {
		if (!token) return;
		try {
			const client = requireConvexClient();
			offerings = (await client.query(api.academics.listOfferings, {
				token
			})) as unknown as Offering[];
		} catch {
			// Non-fatal: counts refresh on the next full load.
		}
	}

	async function toggleOpen() {
		if (!token || !selected) return;
		togglingOpen = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.setOfferingOpen, {
				token,
				id: selected._id as never,
				open: !selected.openForEnrolment
			});
			await refreshCounts();
			const fresh = offerings.find((o) => o._id === selectedId);
			if (fresh) {
				reportSuccess(
					fresh.openForEnrolment
						? 'Self-enrolment is open — students can join themselves.'
						: 'Self-enrolment is closed — only you can add students.'
				);
			}
		} catch (err) {
			reportError(err, 'Could not change self-enrolment.');
		} finally {
			togglingOpen = false;
		}
	}

	/**
	 * Bring older courses in line with the open-by-default rule: placements
	 * made before the default flipped are still closed, so one tap opens
	 * every course still waiting. Already-open courses are untouched.
	 */
	async function openAll() {
		if (!token || closedOfferings.length === 0) return;
		openingAll = true;
		try {
			const client = requireConvexClient();
			for (const o of closedOfferings) {
				await client.mutation(api.academics.setOfferingOpen, {
					token,
					id: o._id as never,
					open: true
				});
			}
			await refreshCounts();
			reportSuccess(
				`Self-enrolment is now open for all ${offerings.length} of your courses — students can join themselves.`
			);
		} catch (err) {
			reportError(err, 'Could not open every course. Those already opened stay open — try again for the rest.');
		} finally {
			openingAll = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	{#if loading}
		<div class="flex flex-col gap-2">
			<div class="h-8 w-64 animate-pulse rounded-md bg-muted"></div>
			<div class="h-40 animate-pulse rounded-md bg-muted"></div>
		</div>
	{:else if offerings.length === 0}
		<Card.Root>
			<Card.Content class="pt-6 text-center text-sm text-muted-foreground">
				No courses assigned to you yet. Ask the admin to assign your courses in the admin console.
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex flex-wrap items-center gap-2">
					<BookOpen class="size-4 text-lams-navy" aria-hidden="true" />
					My courses
					<Badge variant="secondary">{offerings.length}</Badge>
				</Card.Title>
				<Card.Description>
					Pick a course to see who is taking it. You only see the courses assigned to you.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-2">
				{#if closedOfferings.length > 0}
					<div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
						<p class="text-xs text-amber-900">
							<strong>{closedOfferings.length} course{closedOfferings.length === 1 ? '' : 's'}</strong>
							closed to self-enrolment — students in those courses can only be added by you.
						</p>
						<Button size="sm" disabled={openingAll} onclick={openAll}>
							{openingAll ? 'Opening…' : `Open all ${closedOfferings.length}`}
						</Button>
					</div>
				{/if}
				{#each offerings as o (o._id)}
					<button
						type="button"
						onclick={() => select(o._id)}
						aria-pressed={o._id === selectedId}
						class="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-left transition-colors {o._id ===
						selectedId
							? 'border-lams-navy bg-lams-navy/5'
							: 'border-border hover:bg-muted'}"
					>
						<span class="min-w-0">
							<span class="text-sm font-semibold">{o.courseCode} — {o.courseTitle}</span>
							<span class="block text-xs text-muted-foreground">
								{o.programName}{o.yearOfStudy ? ` · Year ${o.yearOfStudy}` : ''} · {o.semesterName}
							</span>
						</span>
						<span class="flex shrink-0 items-center gap-1.5">
							<Badge variant="secondary">
								{o.studentCount} student{o.studentCount === 1 ? '' : 's'}
							</Badge>
							{#if (o.meetingCount ?? 0) > 0}
								<Badge variant="outline">
									{o.meetingCount} slot{o.meetingCount === 1 ? '' : 's'}
								</Badge>
							{/if}
						</span>
					</button>
				{/each}
			</Card.Content>
		</Card.Root>

		{#if selected}
			<Card.Root>
				<Card.Header>
					<Card.Title>
						{selected.courseCode} — {selected.courseTitle}
					</Card.Title>
					<Card.Description>
						{selected.programName}{selected.yearOfStudy
							? ` · Year ${selected.yearOfStudy}`
							: ''} · {selected.semesterName}
						{#if meetings.length > 0}
							<span class="block mt-1">
								Meets:
								{#each meetings as m, i (m._id)}
									{m.kind === 'weekly'
										? `${m.dayName} ${m.startTime}–${m.endTime}`
										: `${m.date} ${m.startTime}–${m.endTime}`}{m.room
										? ` (Room ${m.room})`
										: ''}{i < meetings.length - 1 ? ' · ' : ''}
								{/each}
							</span>
						{/if}
					</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-wrap items-center gap-2">
					{#if selected.openForEnrolment}
						<Badge class="bg-emerald-600 text-white">Open — students can join themselves</Badge>
					{:else}
						<Badge variant="outline">Closed — only you can add students</Badge>
					{/if}
					<Button variant="outline" size="sm" disabled={togglingOpen} onclick={toggleOpen}>
						{togglingOpen ? 'Saving…' : selected.openForEnrolment ? 'Close self-enrolment' : 'Open self-enrolment'}
					</Button>
					<Button variant="secondary" size="sm" href="/scan">Take attendance</Button>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title class="flex flex-wrap items-center gap-2">
						Taking this course
						<Badge variant="secondary">{roster.length}</Badge>
					</Card.Title>
					<Card.Description>
						Everyone enrolled in {selected.courseCode}. Withdrawing removes them from the
						register; attendance already recorded is kept. A program rep takes attendance
						for everything {selected.programName} takes.
					</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-col gap-3">
					<div class="relative">
						<Search
							class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							class="pl-9"
							bind:value={rosterSearch}
							placeholder="Search this course by name, reg number or student ID"
							aria-label="Search this course"
						/>
					</div>
					{#if rosterLoading}
						<div class="h-24 animate-pulse rounded-md bg-muted"></div>
					{:else if filteredRoster.length === 0}
						<p
							class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground"
						>
							{roster.length === 0
								? 'Nobody is taking this course yet. Add them below.'
								: 'No student in this course matches that search.'}
						</p>
					{:else}
						<div class="overflow-x-auto rounded-md border">
							<Table.Root>
								<Table.Header>
							<Table.Row>
									<Table.Head>Name</Table.Head>
									<Table.Head>Added by</Table.Head>
									<Table.Head class="text-right">Actions</Table.Head>
								</Table.Row>
								</Table.Header>
								<Table.Body>
								{#each filteredRoster as r (r.personId)}
									<Table.Row>
										<Table.Cell class="font-medium whitespace-nowrap">
											<span class="flex flex-wrap items-center gap-1.5">
												{r.fullName}
												{#if repIds.has(String(r.personId))}
													<Badge class="bg-lams-navy text-white">
														<UserRoundCheck class="size-3" aria-hidden="true" /> Rep
													</Badge>
												{/if}
											</span>
											<span class="block font-mono text-xs font-normal text-muted-foreground">
												{r.regNumber} · {r.studentId}
											</span>
										</Table.Cell>
										<Table.Cell class="text-xs text-muted-foreground">{r.addedBy}</Table.Cell>
										<Table.Cell class="text-right whitespace-nowrap">
											{#if r.status !== 'blocked'}
												<Button
													variant={repIds.has(String(r.personId)) ? 'secondary' : 'outline'}
													size="sm"
													disabled={busyId === r.personId}
													title={repIds.has(String(r.personId))
														? `Remove ${r.fullName} as a program rep`
														: `Make ${r.fullName} a program rep for ${selected?.programName ?? 'this program'}`}
													onclick={() => toggleRep(r.personId, r.fullName)}
												>
													{repIds.has(String(r.personId)) ? 'Remove rep' : 'Make rep'}
												</Button>
											{/if}
											<Button
												variant="ghost"
												size="icon-sm"
												class="text-red-700"
												title={`Withdraw ${r.fullName} from this course`}
												aria-label={`Withdraw ${r.fullName} from this course`}
												disabled={busyId === r.personId}
												onclick={() => withdraw(r.personId, r.fullName)}
											>
												<UserMinus class="size-3.5" aria-hidden="true" />
											</Button>
										</Table.Cell>
									</Table.Row>
								{/each}
								</Table.Body>
							</Table.Root>
						</div>
					{/if}
					{#if !rosterLoading && joinRequests.length > 0}
						<div class="rounded-md border border-lams-green/40 bg-lams-green/5 p-3">
							<p class="text-sm font-semibold text-lams-navy">
								Join requests ({joinRequests.length})
							</p>
							<p class="text-xs text-muted-foreground">
								Students from other programmes asking to join {selected.courseCode}. Approving
								enrols them immediately; their past records are unaffected.
							</p>
							<ul class="mt-2 flex flex-col divide-y divide-border rounded-md border border-border bg-background">
								{#each joinRequests as j (j._id)}
									<li class="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
										<span class="min-w-0">
											<span class="font-medium">{j.fullName}</span>
											<span class="block font-mono text-xs text-muted-foreground">
												{j.regNumber} · {j.studentId}
											</span>
										</span>
										<span class="flex gap-1.5">
											<Button
												size="sm"
												disabled={busyId === j._id}
												onclick={() => decideRequest(j._id, j.fullName, true)}
											>
												Admit
											</Button>
											<Button
												size="sm"
												variant="outline"
												disabled={busyId === j._id}
												onclick={() => decideRequest(j._id, j.fullName, false)}
											>
												Reject
											</Button>
										</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if !rosterLoading && withdrawnRoster.length > 0}
						<div class="rounded-md border border-red-200 bg-red-50/50 p-3">
							<p class="text-sm font-semibold text-red-800">
								Withdrawn ({withdrawnRoster.length})
							</p>
							<p class="text-xs text-red-700">
								Automatically withdrawn after 4 consecutive absences. Past attendance is kept.
								Re-add them below to re-admit.
							</p>
							<ul class="mt-2 flex flex-col divide-y divide-red-100">
								{#each withdrawnRoster as w (w.personId)}
									<li class="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
										<span class="min-w-0">
											<span class="font-medium">{w.fullName}</span>
											<span class="block font-mono text-xs text-muted-foreground">
												{w.regNumber} · {w.studentId}
											</span>
											<span class="block text-xs text-red-700">{w.withdrawReason}</span>
										</span>
										<Button
											size="sm"
											variant="outline"
											disabled={busyId === w.personId}
											onclick={() => addExisting(w.personId, w.fullName)}
										>
											Re-admit
										</Button>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title class="flex items-center gap-2 text-base">
						<Plus class="size-4" aria-hidden="true" /> Add students to {selected.courseCode}
					</Card.Title>
					<Card.Description>
						Search everyone — including repeats from other programs — tick several and add
						them together. Or register brand-new students straight into this course, one or
						a whole pasted list.
					</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-col gap-3">
					<form class="flex flex-col gap-2 sm:flex-row" onsubmit={searchAll}>
						<div class="relative flex-1">
							<Search
								class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
								aria-hidden="true"
							/>
							<Input
								class="pl-9"
								bind:value={addSearch}
								placeholder="Search all students (min 2 letters)"
								aria-label="Search all students"
							/>
						</div>
						<Button type="submit" variant="secondary" disabled={searching || addSearch.trim().length < 2}>
							{searching ? 'Searching…' : 'Search'}
						</Button>
					</form>

					{#if searched}
						{#if addable.length === 0}
							<p class="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
								Nothing to add — everyone matching that search is already in this course.
							</p>
						{:else}
							<div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 p-2">
								<label class="flex cursor-pointer items-center gap-2 text-xs font-medium">
									<Checkbox
										checked={allAddableSelected}
										onCheckedChange={toggleSelectAll}
										aria-label="Select all search results"
									/>
									Select all ({addable.length})
									{#if selectedToAdd.size > 0}
										<span class="text-muted-foreground">· {selectedToAdd.size} ticked</span>
									{/if}
								</label>
								<Button
									size="sm"
									disabled={selectedToAdd.size === 0 || addingMany}
									onclick={addSelected}
								>
									{addingMany ? 'Adding…' : `Add selected (${selectedToAdd.size})`}
								</Button>
							</div>
							<ul class="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-md border">
								{#each addable as c (c._id)}
									<li class="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
										<span class="flex min-w-0 items-start gap-2">
											<Checkbox
												id={`lec-add-${c._id}`}
												checked={selectedToAdd.has(String(c._id))}
												onCheckedChange={() => toggleSelect(String(c._id))}
												aria-label={`Select ${c.fullName}`}
												class="mt-1"
											/>
											<span class="min-w-0">
												<label for={`lec-add-${c._id}`} class="cursor-pointer font-medium">{c.fullName}</label>
												<span class="block text-xs text-muted-foreground">
													<span class="font-mono">{c.regNumber}</span> · {c.studentId}
													{#if programNamesOf(c.programIds)}
														· {programNamesOf(c.programIds)}
													{/if}
												</span>
											</span>
										</span>
										<Button
											variant="outline"
											size="sm"
											disabled={busyId === c._id || addingMany}
											onclick={() => addExisting(c._id, c.fullName)}
										>
											Add
										</Button>
									</li>
								{/each}
							</ul>
						{/if}
					{/if}

					<div class="border-t border-border pt-3">
						<Button size="sm" variant={showRegister ? 'secondary' : 'outline'} onclick={() => (showRegister = !showRegister)}>
							<UserPlus class="size-3.5" aria-hidden="true" />
							{showRegister ? 'Close registration' : 'Register a new student into this course'}
						</Button>
						{#if showRegister}
							<p class="mt-2 text-xs text-muted-foreground">
								They join <strong>{selected.programName}</strong> and this course in one step.
								They sign in later with their reg number + student ID.
							</p>
							<form class="mt-2 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]" onsubmit={registerAndEnrol}>
								<div class="flex flex-col gap-1">
									<Label for="lr-name">Full name</Label>
									<Input id="lr-name" bind:value={newName} placeholder="e.g. Amina Banda" required />
								</div>
								<div class="flex flex-col gap-1">
									<Label for="lr-reg">Registration number</Label>
									<Input id="lr-reg" bind:value={newReg} placeholder="e.g. BIT/2024/0123" required />
								</div>
								<div class="flex flex-col gap-1">
									<Label for="lr-sid">Student ID</Label>
									<Input id="lr-sid" bind:value={newSid} placeholder="e.g. 2024-0123" required />
								</div>
								<div class="flex items-end">
									<Button type="submit" disabled={registering}>
										{registering ? 'Adding…' : 'Register + add'}
									</Button>
								</div>
							</form>
							<div class="mt-3 flex flex-col gap-2 border-t border-border pt-3">
								<Label for="lr-bulk">Or register many at once — one per line</Label>
								<Textarea
									id="lr-bulk"
									class="min-h-20"
									bind:value={bulkRegisterText}
									placeholder={'Amina Banda, BIT/2024/0123, 2024-0123\nJohn Phiri, BIT/2024/0124, 2024-0124'}
								/>
								<div>
									<Button
										variant="secondary"
										size="sm"
										disabled={registeringMany || bulkRegisterRows.length === 0}
										onclick={registerMany}
									>
										{registeringMany
											? 'Registering…'
											: `Register + add these (${bulkRegisterRows.length})`}
									</Button>
								</div>
							</div>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>
