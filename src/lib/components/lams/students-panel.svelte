<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import { parseRosterCsv } from '$lib/lams/csv';
	import * as Card from '$lib/components/ui/card';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Table from '$lib/components/ui/table';
	import { BookOpen, KeyRound, Pencil, Plus, Search, Smartphone, UserCheck, UserRoundCheck, UserX } from '@lucide/svelte';
	import ProgramPicker from './program-picker.svelte';
	import PersonEditDialog from './person-edit-dialog.svelte';
	import StudentCoursesDialog from './student-courses-dialog.svelte';
	import StudentsBulkEnrol from './students-bulk-enrol.svelte';
	import type { ProgramRow, PersonRow } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	/**
	 * The Students tab: everyone registered, and what each of them studies.
	 *
	 * Registration and course assignment live together on purpose. They used to
	 * be apart — students here, courses only from a course's own roster — which
	 * meant the question people actually ask ("what is this student taking?")
	 * had no answer on any screen.
	 *
	 * The program filter is a view, not a wall: "Everyone" lists the whole roll,
	 * which is the only sensible default for a school office.
	 */
	let token = getToken();
	let programs = $state<ProgramRow[]>([]);
	let people = $state<PersonRow[]>([]);
	let repIds = $state<Set<string>>(new Set());
	let programId = $state('');
	let search = $state('');
	let loading = $state(true);
	let busy = $state(false);
	let showAdd = $state(false);

	// Add-student form.
	let newName = $state('');
	let newReg = $state('');
	let newSid = $state('');
	let pasteText = $state('');
	/** Which program a brand-new student joins: the current filter, or the first. */
	const addTargetProgramId = $derived(programId || programs[0]?._id || '');

	// Dialogs.
	let editing = $state<PersonRow | null>(null);
	let editOpen = $state(false);
	let coursesFor = $state<PersonRow | null>(null);
	let coursesOpen = $state(false);
	let suspendTarget = $state<PersonRow | null>(null);
	let suspendOpen = $state(false);

	const programNameById = $derived(new Map(programs.map((p) => [p._id, p.name])));

	const filtered = $derived(
		people.filter((p) => {
			const q = search.trim().toLowerCase();
			if (!q) return true;
			return (
				p.fullName.toLowerCase().includes(q) ||
				p.regNumber.toLowerCase().includes(q) ||
				p.studentId.toLowerCase().includes(q)
			);
		})
	);
	const notSetUp = $derived(people.filter((p) => p.status === 'invited').length);
	const withoutProgram = $derived(people.filter((p) => p.programIds.length === 0).length);

	function programNamesOf(p: PersonRow): string {
		return p.programIds
			.map((id) => programNameById.get(id))
			.filter((n): n is string => Boolean(n))
			.join(', ');
	}

	onMount(async () => {
		if (!token) {
			loading = false;
			return;
		}
		try {
			const client = requireConvexClient();
			programs = (await client.query(api.academics.listPrograms, { token })) as unknown as ProgramRow[];
			await loadPeople();
		} catch (err) {
			reportError(err, 'Could not load the students.');
		} finally {
			loading = false;
		}
	});

	/**
	 * The whole roll, or one program's roll. `withoutProgram` is published under
	 * its own filter rather than being hidden behind a toggle, because a student
	 * with no program cannot be given a single course and therefore needs to be
	 * found on purpose.
	 */
	async function loadPeople() {
		try {
			const client = requireConvexClient();
			if (programId === '__none__') {
				people = (await client.query(api.people.listPeople, {
					token,
					withoutProgram: true
				})) as unknown as PersonRow[];
				repIds = new Set();
				return;
			}
			const [rows, reps] = (await Promise.all([
				client.query(api.people.listPeople, {
					token,
					...(programId ? { programId: programId as never } : {})
				}),
				programId
					? client.query(api.reps.listForProgram, { token, programId: programId as never })
					: Promise.resolve([] as { personId: string }[])
			])) as [PersonRow[], { personId: string }[]];
			people = rows;
			repIds = new Set(reps.map((r) => r.personId));
		} catch (err) {
			reportError(err, 'Could not load the students.');
		}
	}

	async function addPerson(e: SubmitEvent) {
		e.preventDefault();
		if (!addTargetProgramId) {
			reportError(new Error('No program.'), 'Create a program first — a student has to join one.');
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.people.createPerson, {
				token,
				fullName: newName.trim(),
				regNumber: newReg.trim(),
				studentId: newSid.trim(),
				role: 'student',
				programId: addTargetProgramId as never
			});
			newName = '';
			newReg = '';
			newSid = '';
			await loadPeople();
			reportSuccess('Student added. Give them courses with the Courses button.');
		} catch (err) {
			reportError(err, 'Could not add the student.');
		} finally {
			busy = false;
		}
	}

	async function addMany() {
		const rows = parseRosterCsv(pasteText);
		if (rows.length === 0) {
			toast.error('No usable lines found. Use: Full Name, Registration Number, Student ID.');
			return;
		}
		if (!addTargetProgramId) {
			reportError(new Error('No program.'), 'Create a program first — students have to join one.');
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			const res = await client.mutation(api.people.importPeople, {
				token,
				programId: addTargetProgramId as never,
				rows
			});
			pasteText = '';
			await loadPeople();
			reportSuccess(`Added ${res.added} student(s). ${res.skipped} were skipped as duplicates or incomplete.`);
		} catch (err) {
			reportError(err, 'Could not add those students.');
		} finally {
			busy = false;
		}
	}

	async function resetPin(id: string) {
		if (!confirm('Reset this student’s PIN? They choose a new one next time they sign in.')) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.people.resetPin, { token, personId: id as never });
			await loadPeople();
			reportSuccess('PIN reset.');
		} catch (err) {
			reportError(err, 'Could not reset the PIN.');
		}
	}

	async function newPhone(id: string) {
		if (!confirm('Move this account to a new phone? Their PIN stays the same.')) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.people.clearDevice, { token, personId: id as never });
			await loadPeople();
			reportSuccess('They can now sign in on a different phone.');
		} catch (err) {
			reportError(err, 'Could not move the account.');
		}
	}

	async function setSuspended(suspend: boolean) {
		if (!suspendTarget) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.people.setBlocked, {
				token,
				personId: suspendTarget._id as never,
				blocked: suspend
			});
			await loadPeople();
			reportSuccess(
				suspend
					? `${suspendTarget.fullName} can no longer sign in.`
					: `${suspendTarget.fullName} can sign in again.`
			);
		} catch (err) {
			reportError(err, 'Could not change that.');
		} finally {
			suspendOpen = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	{#if loading}
		<div class="flex flex-col gap-2">
			<div class="h-8 w-64 animate-pulse rounded-md bg-muted"></div>
			<div class="h-40 animate-pulse rounded-md bg-muted"></div>
		</div>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex flex-wrap items-center gap-2">
					Students
					<Badge variant="secondary">{people.length} shown</Badge>
					{#if notSetUp > 0}
						<Badge class="bg-amber-600 text-white">{notSetUp} have not set a PIN yet</Badge>
					{/if}
					{#if withoutProgram > 0}
						<Badge variant="outline">{withoutProgram} with no program</Badge>
					{/if}
				</Card.Title>
				<Card.Description>
					Everyone on the roll, with the courses each of them studies. Only someone with this
					console can add students, so nobody can add themselves. A student who repeats a course
					from another program can sit in both — tick the second program in Edit.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				<div class="flex flex-wrap items-end justify-between gap-3">
					<div class="min-w-0 flex-1">
						<ProgramPicker
							{programs}
							bind:programId
							showCounts="students"
							emptyHint="No programs yet — create one on the Programs tab, then students can join it."
						/>
					</div>
					<Button size="sm" onclick={() => (showAdd = !showAdd)}>
						<Plus class="size-3.5" aria-hidden="true" />
						{showAdd ? 'Close' : 'Add students'}
					</Button>
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<Button
						variant={programId === '' ? 'secondary' : 'outline'}
						size="sm"
						class="rounded-full"
						onclick={() => (programId = '')}
					>
						Everyone
					</Button>
					<Button
						variant={programId === '__none__' ? 'secondary' : 'outline'}
						size="sm"
						class="rounded-full"
						onclick={() => (programId = '__none__')}
					>
						No program ({withoutProgram})
					</Button>
				</div>

			<div class="relative">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					class="pl-9"
					bind:value={search}
					placeholder="Search name, registration number or student ID"
					aria-label="Search students"
				/>
			</div>

			<StudentsBulkEnrol {token} {programs} ondone={loadPeople} />

				{#if showAdd}
					<div class="flex flex-col gap-3 rounded-md border border-border p-3">
						{#if programs.length === 0}
							<p class="text-sm text-muted-foreground">
								Create a program first — a student has to join one before they can be given any
								course.
							</p>
						{:else}
							<p class="text-xs text-muted-foreground">
								New students join
								<strong>{programs.find((p) => p._id === addTargetProgramId)?.name ?? '—'}</strong
								>. Change the filter above to add them somewhere else.
							</p>
							<form class="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]" onsubmit={addPerson}>
								<div class="flex flex-col gap-1">
									<Label for="pn">Full name</Label>
									<Input id="pn" bind:value={newName} placeholder="e.g. Amina Banda" required />
								</div>
								<div class="flex flex-col gap-1">
									<Label for="pr">Registration number</Label>
									<Input id="pr" bind:value={newReg} placeholder="e.g. BIT/2024/0123" required />
								</div>
								<div class="flex flex-col gap-1">
									<Label for="ps">Student ID</Label>
									<Input id="ps" bind:value={newSid} placeholder="e.g. 2024-0123" required />
								</div>
								<div class="flex items-end">
									<Button type="submit" disabled={busy}>Add</Button>
								</div>
							</form>
							<div class="flex flex-col gap-2">
								<Label for="bulk">Or add many at once — one per line</Label>
								<Textarea
									id="bulk"
									class="min-h-20"
									bind:value={pasteText}
									placeholder={'Amina Banda, BIT/2024/0123, 2024-0123\nJohn Phiri, BIT/2024/0124, 2024-0124'}
								/>
								<div>
									<Button variant="secondary" size="sm" onclick={addMany} disabled={busy}>
										Add these students
									</Button>
								</div>
							</div>
						{/if}
					</div>
				{/if}

				{#if filtered.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						{people.length === 0
							? programId === '__none__'
								? 'Nobody is waiting for a program.'
								: 'No students here yet. Add them above — anyone not recorded is marked absent.'
							: 'No student matches that search.'}
					</p>
				{:else}
					<div class="overflow-x-auto rounded-md border">
						<Table.Root>
							<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Program</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each filtered as p (p._id)}
									<Table.Row>
									<Table.Cell class="font-medium whitespace-nowrap">
										<span class="flex items-center gap-1.5">
											{p.fullName}
											{#if repIds.has(p._id)}
												<Badge class="bg-lams-navy text-white">
													<UserRoundCheck class="size-3" aria-hidden="true" /> Rep
												</Badge>
											{/if}
										</span>
										<span class="block font-mono text-xs font-normal text-muted-foreground">
											{p.regNumber} · {p.studentId}
										</span>
									</Table.Cell>
								<Table.Cell class="text-xs">
									{#if programNamesOf(p)}
										{programNamesOf(p)}
									{:else}
										<span class="font-semibold text-amber-700">No program</span>
									{/if}
									<span class="block text-muted-foreground">
										{#if (p.courseCount ?? 0) === 0}
											<span class="font-medium text-amber-700">No courses yet</span>
										{:else}
											{p.courseCount} course{p.courseCount === 1 ? '' : 's'}
										{/if}
									</span>
								</Table.Cell>
										<Table.Cell>
											{#if p.status === 'active'}
												<Badge variant="secondary">Ready</Badge>
											{:else if p.status === 'invited'}
												<Badge class="bg-amber-600 text-white">No PIN yet</Badge>
											{:else}
												<Badge class="bg-red-600 text-white">Suspended</Badge>
											{/if}
										</Table.Cell>
								<Table.Cell class="text-right whitespace-nowrap">
									<div class="flex items-center justify-end gap-0.5">
										<Button
											variant="outline"
											size="icon-sm"
											title={`Courses for ${p.fullName}`}
											aria-label={`Courses for ${p.fullName}`}
											onclick={() => {
												coursesFor = p;
												coursesOpen = true;
											}}
										>
											<BookOpen class="size-3.5" aria-hidden="true" />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											title={`Edit ${p.fullName}`}
											aria-label={`Edit ${p.fullName}`}
											onclick={() => {
												editing = p;
												editOpen = true;
											}}
										>
											<Pencil class="size-3.5" aria-hidden="true" />
										</Button>
										{#if p.status === 'active'}
											<Button
												variant="ghost"
												size="icon-sm"
												class="text-red-700"
												title={`Suspend ${p.fullName}`}
												aria-label={`Suspend ${p.fullName}`}
												onclick={() => {
													suspendTarget = p;
													suspendOpen = true;
												}}
											>
												<UserX class="size-3.5" aria-hidden="true" />
											</Button>
										{:else if p.status === 'blocked'}
											<Button
												variant="ghost"
												size="icon-sm"
												title={`Unblock ${p.fullName}`}
												aria-label={`Unblock ${p.fullName}`}
												onclick={() => {
													suspendTarget = p;
													suspendOpen = true;
												}}
											>
												<UserCheck class="size-3.5" aria-hidden="true" />
											</Button>
										{/if}
										{#if p.status !== 'blocked'}
											<Button
												variant="ghost"
												size="icon-sm"
												title={`Reset PIN for ${p.fullName}`}
												aria-label={`Reset PIN for ${p.fullName}`}
												onclick={() => resetPin(p._id)}
											>
												<KeyRound class="size-3.5" aria-hidden="true" />
											</Button>
										{/if}
										{#if p.hasDevice}
											<Button
												variant="ghost"
												size="icon-sm"
												title={`Move ${p.fullName} to a new phone`}
												aria-label={`Move ${p.fullName} to a new phone`}
												onclick={() => newPhone(p._id)}
											>
												<Smartphone class="size-3.5" aria-hidden="true" />
											</Button>
										{/if}
									</div>
								</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<PersonEditDialog
	bind:open={editOpen}
	person={editing}
	{programs}
	{token}
	onsaved={loadPeople}
/>

<StudentCoursesDialog
	bind:open={coursesOpen}
	{token}
	person={coursesFor}
	onchanged={loadPeople}
/>

<AlertDialog.Root bind:open={suspendOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{suspendTarget?.status === 'blocked'
					? `Unblock ${suspendTarget?.fullName}?`
					: `Suspend ${suspendTarget?.fullName}?`}
			</AlertDialog.Title>
			<AlertDialog.Description>
				{suspendTarget?.status === 'blocked'
					? 'They will be able to sign in again straight away.'
					: 'They are signed out everywhere and cannot sign in until you unblock them. Their records are kept.'}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => setSuspended(suspendTarget?.status !== 'blocked')}>
				{suspendTarget?.status === 'blocked' ? 'Unblock' : 'Suspend'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
