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
	import * as Table from '$lib/components/ui/table';
	import { BookOpen, Plus, Search, UserPlus, UserMinus } from '@lucide/svelte';
	import type { Meeting, Offering, ProgramRow } from '$lib/lams/types';
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
	 * Adding is `assignForPerson` (enroll true), removing is the same call
	 * with enroll false — a withdrawal, never a delete, so attendance history
	 * is kept. Registering a student entirely is `createPerson` in the
	 * course's program plus an immediate enrol, in one save.
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
			addedBy: 'self' | 'rep' | 'lecturer';
		}[]
	>([]);
	let meetings = $state<Meeting[]>([]);
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
	let togglingOpen = $state(false);

	const selected = $derived(offerings.find((o) => o._id === selectedId) ?? null);
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
			return;
		}
		rosterLoading = true;
		try {
			const client = requireConvexClient();
			const [rows, slots] = (await Promise.all([
				client.query(api.enrolments.listForOffering, {
					token,
					offeringId: selectedId as never
				}),
				client.query(api.timetable.listForOffering, {
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
					addedBy: 'self' | 'rep' | 'lecturer';
				}[],
				Meeting[]
			];
			roster = rows;
			meetings = slots;
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
		} catch (err) {
			reportError(err, 'Could not search students.');
		} finally {
			searching = false;
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
			await loadRoster();
			await refreshCounts();
			reportSuccess(`${fullName} added to ${selected?.courseCode ?? 'the course'}.`);
		} catch (err) {
			reportError(err, 'Could not add that student.');
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

	async function registerAndEnrol(e: SubmitEvent) {
		e.preventDefault();
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
			const personId = (await client.mutation(api.people.createPerson, {
				token,
				fullName: newName.trim(),
				regNumber: newReg.trim(),
				studentId: newSid.trim(),
				role: 'student',
				programId: selected.programId as never
			})) as string;
			await client.mutation(api.enrolments.assignForPerson, {
				token,
				personId: personId as never,
				offeringId: selected._id as never,
				enroll: true
			});
			newName = '';
			newReg = '';
			newSid = '';
			showRegister = false;
			await loadRoster();
			await refreshCounts();
			reportSuccess('Student registered and added to this course.');
		} catch (err) {
			reportError(err, 'Could not register that student. If the reg number exists, add them from search instead.');
		} finally {
			registering = false;
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
						register; attendance already recorded is kept.
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
										<Table.Head>Registration number</Table.Head>
										<Table.Head>Added by</Table.Head>
										<Table.Head class="text-right">Actions</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each filteredRoster as r (r.personId)}
										<Table.Row>
											<Table.Cell class="font-medium">
												{r.fullName}
												<span class="block text-xs font-normal text-muted-foreground">
													{r.studentId}
												</span>
											</Table.Cell>
											<Table.Cell class="font-mono text-xs">{r.regNumber}</Table.Cell>
											<Table.Cell class="text-xs text-muted-foreground">{r.addedBy}</Table.Cell>
											<Table.Cell class="text-right">
												<Button
													variant="ghost"
													size="sm"
													class="text-red-700"
													disabled={busyId === r.personId}
													onclick={() => withdraw(r.personId, r.fullName)}
												>
													<UserMinus class="size-3.5" aria-hidden="true" /> Withdraw
												</Button>
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
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
						Search everyone — including repeats from other programs — and add them here. Or
						register a brand-new student straight into this course.
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
							<ul class="flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-md border">
								{#each addable as c (c._id)}
									<li class="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
										<span class="min-w-0">
											<span class="font-medium">{c.fullName}</span>
											<span class="block text-xs text-muted-foreground">
												<span class="font-mono">{c.regNumber}</span> · {c.studentId}
												{#if programNamesOf(c.programIds)}
													· {programNamesOf(c.programIds)}
												{/if}
											</span>
										</span>
										<Button
											variant="outline"
											size="sm"
											disabled={busyId === c._id}
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
						{/if}
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>
