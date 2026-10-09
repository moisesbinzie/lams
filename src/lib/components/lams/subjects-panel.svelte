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
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import { TriangleAlert } from '@lucide/svelte';
	import ClassPicker from './class-picker.svelte';
	import SubjectEditDialog from './subject-edit-dialog.svelte';
	import OfferingRosterDialog from './offering-roster-dialog.svelte';
	import type { ClassRow, Offering, Subject } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';
	import { toast } from 'svelte-sonner';
	import { sessionMe } from '$lib/lams/session.svelte';

	let token = getToken();
	let classes = $state<ClassRow[]>([]);
	let classId = $state('');
	let subjects = $state<Subject[]>([]);
	let offerings = $state<Offering[]>([]);
	let loading = $state(true);
	let busy = $state(false);

	// New subject form.
	let code = $state('');
	let title = $state('');
	let hours = $state('3');

	// Offer-to-class picker.
	let pickSubjectId = $state('');

	/**
	 * bits-ui refuses an empty string as a select item's value, so "nothing
	 * chosen yet" travels through the menu as a sentinel and is mapped back to
	 * the empty id at both edges.
	 */
	const NO_SUBJECT = 'no-subject';

	// Dialogs.
	let editing = $state<Subject | null>(null);
	let editOpen = $state(false);
	let removing = $state<Subject | null>(null);
	let removeOpen = $state(false);
	let rosterFor = $state<Offering | null>(null);
	let rosterOpen = $state(false);

	const me = $derived(sessionMe());
	const isAdmin = $derived(me?.kind === 'staff' && (me.isAdmin === true || me.role === 'admin'));

	const notOffered = $derived(subjects.filter((s) => !offerings.some((o) => o.subjectId === s._id)));
	const selectedClass = $derived(classes.find((c) => c._id === classId) ?? null);

	onMount(async () => {
		if (!token) return;
		try {
			const client = requireConvexClient();
			const [cls, subs] = (await Promise.all([
				client.query(api.academics.listClasses, { token }),
				client.query(api.academics.listSubjects, { token })
			])) as [ClassRow[], Subject[]];
			classes = cls;
			subjects = subs;
			if (!classId && classes.length > 0) classId = classes[0]._id;
		} catch (err) {
			reportError(err, 'Could not load subjects.');
		} finally {
			loading = false;
		}
	});

	async function load() {
		if (!classId) {
			offerings = [];
			return;
		}
		try {
			const client = requireConvexClient();
			offerings = (await client.query(api.academics.listOfferings, {
				token,
				classId: classId as never
			})) as unknown as Offering[];
		} catch (err) {
			reportError(err, 'Could not load the offerings.');
		}
	}

	$effect(() => {
		// Clear the pending offer first: the offerings list reloads async, and
		// until it does a stale subject id matches no item — the trigger would
		// show the raw id instead of a name.
		pickSubjectId = '';
		if (classId) void load();
	});

	async function createSubject(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.createSubject, {
				token,
				code: code.trim(),
				title: title.trim(),
				hoursPerWeek: Number(hours) || undefined
			});
			code = '';
			title = '';
			subjects = (await client.query(api.academics.listSubjects, { token })) as unknown as Subject[];
			reportSuccess('Subject saved to the catalogue. Offer it to a class below.');
		} catch (err) {
			reportError(err, 'Could not save the subject.');
		} finally {
			busy = false;
		}
	}

	async function offer() {
		if (!selectedClass?.semesterId) {
			toast.error('Assign a semester to this class first (Classes & semesters tab).');
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.createOffering, {
				token,
				subjectId: pickSubjectId as never,
				classId: classId as never,
				semesterId: selectedClass.semesterId as never
			});
			pickSubjectId = '';
			await load();
			reportSuccess('Subject added. Set its timetable, then open enrolment or assign students.');
		} catch (err) {
			reportError(err, 'Could not add that subject.');
		} finally {
			busy = false;
		}
	}

	async function toggleOpen(offeringId: string, open: boolean) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.setOfferingOpen, { token, id: offeringId as never, open });
			await load();
			reportSuccess(
				open
					? 'Students in this class can now join this subject themselves.'
					: 'Self-enrolment closed for this subject.'
			);
		} catch (err) {
			reportError(err, 'Could not change enrolment.');
		}
	}

	async function removeSubjectConfirmed() {
		if (!removing) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeSubject, { token, id: removing._id as never });
			subjects = (await client.query(api.academics.listSubjects, { token })) as unknown as Subject[];
			await load();
			reportSuccess(`${removing.code} removed from the catalogue.`);
		} catch (err) {
			reportError(err, 'Could not remove the subject.');
		} finally {
			removeOpen = false;
		}
	}

	async function removeOffering(id: string) {
		if (!confirm('Remove this subject from the class? Enrolled students must be withdrawn first.')) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeOffering, { token, id: id as never });
			await load();
		} catch (err) {
			// The server refuses while students are still enrolled.
			reportError(err, 'Could not remove it.');
		}
	}
</script>

<div class="flex flex-col gap-4">
	{#if loading}
		<div class="h-24 animate-pulse rounded-md bg-muted"></div>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex flex-wrap items-center justify-between gap-2">
					<span>{isAdmin ? 'Subject catalogue' : 'My subjects'}</span>
				</Card.Title>
				<Card.Description>
					{isAdmin
						? 'A subject is saved once with its code — e.g. BIT 221 — and can then be offered to any class.'
						: 'Subjects assigned to you by the admin.'}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{#if isAdmin}
					<form class="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto]" onsubmit={createSubject}>
						<div class="flex flex-col gap-1">
							<Label for="sc">Code</Label>
							<Input id="sc" bind:value={code} placeholder="e.g. BIT 221" required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="st">Title</Label>
							<Input id="st" bind:value={title} placeholder="e.g. Database Systems" required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="sh">Hours/week</Label>
							<Input id="sh" type="number" min="1" max="20" bind:value={hours} />
						</div>
						<div class="flex items-end">
							<Button type="submit" disabled={busy}>Add subject</Button>
						</div>
					</form>
				{/if}

				{#if subjects.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						{isAdmin ? 'The catalogue is empty. Add the first subject above.' : 'No subjects assigned to you yet.'}
					</p>
				{:else}
					<div class="overflow-x-auto rounded-md border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>Code</Table.Head>
									<Table.Head>Title</Table.Head>
									<Table.Head>Hours</Table.Head>
									<Table.Head class="text-right">Actions</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each subjects as s (s._id)}
									<Table.Row>
										<Table.Cell class="font-medium">{s.code}</Table.Cell>
										<Table.Cell>{s.title}</Table.Cell>
										<Table.Cell class="text-muted-foreground">{s.hoursPerWeek ?? '—'}</Table.Cell>
										<Table.Cell class="text-right">
											{#if isAdmin}
												<div class="flex justify-end gap-1">
													<Button
														variant="ghost"
														size="sm"
														onclick={() => {
															editing = s;
															editOpen = true;
														}}
													>
														Edit
													</Button>
													<Button
														variant="ghost"
														size="sm"
														class="text-red-700"
														onclick={() => {
															removing = s;
															removeOpen = true;
														}}
													>
														Remove
													</Button>
												</div>
											{:else}
												<span class="text-xs text-muted-foreground">Assigned</span>
											{/if}
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
				<Card.Title>Subjects this class is taking</Card.Title>
				<Card.Description>
					{isAdmin
						? 'Offer a catalogue subject to the selected class, then decide who takes it.'
						: 'Subjects you teach in the selected class.'}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<ClassPicker {classes} bind:classId emptyHint={isAdmin ? 'No classes yet — add one in “Classes & semesters”.' : 'No classes assigned to you yet.'} />

				{#if !classId}
					<p class="text-sm text-muted-foreground">Choose a class to see its subjects.</p>
				{:else if selectedClass && !selectedClass.semesterId}
					<p class="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" role="status">
						<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
						<span>
							This class has no semester yet. Assign one in “Classes & semesters” — subjects are offered
							per semester.
						</span>
					</p>
				{:else if isAdmin}
					{#if notOffered.length > 0}
						<div class="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-end">
							<div class="flex-1">
								<Label for="pick">Offer a subject from the catalogue</Label>
								<Select.Root
									type="single"
									value={pickSubjectId || NO_SUBJECT}
									onValueChange={(v) => {
										pickSubjectId = v === NO_SUBJECT ? '' : (v ?? '');
									}}
								>
									<Select.Trigger id="pick" class="w-full">
										<Select.Value placeholder="Choose a subject" />
									</Select.Trigger>
									<Select.Content>
										<Select.Group>
											<Select.Item value={NO_SUBJECT}>Choose a subject</Select.Item>
											{#each notOffered as s (s._id)}
												<Select.Item value={s._id} label={`${s.code} — ${s.title}`}>
													{s.code} — {s.title}
												</Select.Item>
											{/each}
										</Select.Group>
									</Select.Content>
								</Select.Root>
							</div>
							<Button disabled={!pickSubjectId || busy} onclick={offer}>Offer it</Button>
						</div>
					{:else if subjects.length > 0}
						<Badge variant="secondary">Every catalogue subject is already offered to this class</Badge>
					{/if}

					{#if offerings.length === 0}
						<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
							No subjects offered to this class yet.
						</p>
					{:else}
						<ul class="flex flex-col divide-y divide-border">
							{#each offerings as o (o._id)}
								<li class="flex flex-wrap items-center justify-between gap-2 py-3">
									<div>
										<p class="text-sm font-semibold">
											{o.subjectCode} — {o.subjectTitle}
											{#if o.hoursPerWeek}
												<span class="font-normal text-muted-foreground">· {o.hoursPerWeek} h/week</span>
											{/if}
										</p>
										<p class="text-xs text-muted-foreground">
											{o.studentCount} student(s) enrolled · {o.semesterName}
											{#if isAdmin && o.lecturerName}
												· {o.lecturerName}
											{/if}
										</p>
									</div>
									<div class="flex flex-wrap items-center gap-2">
										<Button variant="outline" size="sm" onclick={() => {
											rosterFor = o;
											rosterOpen = true;
										}}>Roster ({o.studentCount})</Button>
										{#if o.openForEnrolment}
											<Badge class="bg-emerald-600 text-white">Open to students</Badge>
											<Button variant="outline" size="sm" onclick={() => toggleOpen(o._id, false)}>
												Close enrolment
											</Button>
										{:else}
											<Badge variant="secondary">Closed</Badge>
											<Button variant="secondary" size="sm" onclick={() => toggleOpen(o._id, true)}>
												Let students join
											</Button>
										{/if}
										{#if isAdmin}
											<Button variant="ghost" size="sm" class="text-red-700" onclick={() => removeOffering(o._id)}>
												Remove
											</Button>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					{#if offerings.length === 0}
						<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
							No subjects assigned to you in this class yet.
						</p>
					{:else}
						<ul class="flex flex-col divide-y divide-border">
							{#each offerings as o (o._id)}
								<li class="flex flex-wrap items-center justify-between gap-2 py-3">
									<div>
										<p class="text-sm font-semibold">
											{o.subjectCode} — {o.subjectTitle}
											{#if o.hoursPerWeek}
												<span class="font-normal text-muted-foreground">· {o.hoursPerWeek} h/week</span>
											{/if}
										</p>
										<p class="text-xs text-muted-foreground">
											{o.studentCount} student(s) enrolled · {o.semesterName}
										</p>
									</div>
									<div class="flex flex-wrap items-center gap-2">
										<Button variant="outline" size="sm" onclick={() => {
											rosterFor = o;
											rosterOpen = true;
										}}>Roster ({o.studentCount})</Button>
										{#if o.openForEnrolment}
											<Badge class="bg-emerald-600 text-white">Open to students</Badge>
											<Button variant="outline" size="sm" onclick={() => toggleOpen(o._id, false)}>
												Close enrolment
											</Button>
										{:else}
											<Badge variant="secondary">Closed</Badge>
											<Button variant="secondary" size="sm" onclick={() => toggleOpen(o._id, true)}>
												Let students join
											</Button>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<SubjectEditDialog bind:open={editOpen} subject={editing} {token} onsaved={async () => {
	subjects = (await requireConvexClient().query(api.academics.listSubjects, { token })) as unknown as Subject[];
	await load();
}} />

<OfferingRosterDialog bind:open={rosterOpen} offering={rosterFor} {classes} {token} onchanged={load} />

<AlertDialog.Root bind:open={removeOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove {removing?.code} from the catalogue?</AlertDialog.Title>
			<AlertDialog.Description>
				This only works while no class is taking the subject.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={removeSubjectConfirmed}>Remove</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
