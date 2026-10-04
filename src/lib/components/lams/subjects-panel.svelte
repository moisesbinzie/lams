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
	import { TriangleAlert } from '@lucide/svelte';
	import ClassPicker from './class-picker.svelte';
	import SubjectEditDialog from './subject-edit-dialog.svelte';
	import OfferingRosterDialog from './offering-roster-dialog.svelte';
	import type { ClassRow, Offering, Subject } from '$lib/lams/types';

	let token = getToken();
	let classes = $state<ClassRow[]>([]);
	let classId = $state('');
	let subjects = $state<Subject[]>([]);
	let offerings = $state<Offering[]>([]);
	let loading = $state(true);
	let error = $state('');
	let notice = $state('');
	let busy = $state(false);

	// New subject form.
	let code = $state('');
	let title = $state('');
	let hours = $state('3');

	// Offer-to-class picker.
	let pickSubjectId = $state('');

	// Dialogs.
	let editing = $state<Subject | null>(null);
	let editOpen = $state(false);
	let removing = $state<Subject | null>(null);
	let removeOpen = $state(false);
	let rosterFor = $state<Offering | null>(null);
	let rosterOpen = $state(false);

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
			error = err instanceof Error ? err.message : 'Could not load subjects.';
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
			error = err instanceof Error ? err.message : 'Could not load the offerings.';
		}
	}

	$effect(() => {
		if (classId) void load();
	});

	async function createSubject(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
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
			notice = 'Subject saved to the catalogue. Offer it to a class below.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not save the subject.';
		} finally {
			busy = false;
		}
	}

	async function offer() {
		if (!selectedClass?.semesterId) {
			error = 'Assign a semester to this class first (Classes & semesters tab).';
			return;
		}
		busy = true;
		error = '';
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
			notice = 'Subject added. Set its timetable, then open enrolment or assign students.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not add that subject.';
		} finally {
			busy = false;
		}
	}

	async function toggleOpen(offeringId: string, open: boolean) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.setOfferingOpen, { token, id: offeringId as never, open });
			await load();
			notice = open
				? 'Students in this class can now join this subject themselves.'
				: 'Self-enrolment closed for this subject.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not change enrolment.';
		}
	}

	async function removeSubjectConfirmed() {
		if (!removing) return;
		error = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeSubject, { token, id: removing._id as never });
			subjects = (await client.query(api.academics.listSubjects, { token })) as unknown as Subject[];
			await load();
			notice = `${removing.code} removed from the catalogue.`;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not remove the subject.';
		} finally {
			removeOpen = false;
		}
	}

	async function removeOffering(id: string) {
		if (!confirm('Remove this subject from the class? Enrolled students must be withdrawn first.')) return;
		error = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeOffering, { token, id: id as never });
			await load();
		} catch (err) {
			// The server refuses while students are still enrolled.
			error = err instanceof Error ? err.message : 'Could not remove it.';
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
		<div class="h-24 animate-pulse rounded-md bg-muted"></div>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex flex-wrap items-center justify-between gap-2">
					<span>Subject catalogue</span>
				</Card.Title>
				<Card.Description>
					A subject is saved once with its code — e.g. BIT 221 — and can then be offered to any class.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
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

				{#if subjects.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						The catalogue is empty. Add the first subject above.
					</p>
				{:else}
					<div class="overflow-x-auto rounded-md border">
						<table class="w-full text-sm">
							<thead class="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
								<tr>
									<th class="px-3 py-2 font-medium">Code</th>
									<th class="px-3 py-2 font-medium">Title</th>
									<th class="px-3 py-2 font-medium">Hours</th>
									<th class="px-3 py-2 text-right font-medium">Actions</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-border">
								{#each subjects as s (s._id)}
									<tr>
										<td class="px-3 py-2 font-medium">{s.code}</td>
										<td class="px-3 py-2">{s.title}</td>
										<td class="px-3 py-2 text-muted-foreground">{s.hoursPerWeek ?? '—'}</td>
										<td class="px-3 py-2 text-right">
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
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Subjects this class is taking</Card.Title>
				<Card.Description>
					Offer a catalogue subject to the selected class, then decide who takes it.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<ClassPicker {classes} bind:classId emptyHint="No classes yet — add one in “Classes & semesters”." />

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
				{:else}
					{#if notOffered.length > 0}
						<div class="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-end">
							<div class="flex-1">
								<Label for="pick">Offer a subject from the catalogue</Label>
								<select id="pick" class="w-full rounded-md border border-input bg-background p-2 text-sm" bind:value={pickSubjectId}>
									<option value="">Choose a subject</option>
									{#each notOffered as s (s._id)}
										<option value={s._id}>{s.code} — {s.title}</option>
									{/each}
								</select>
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
										<Button variant="ghost" size="sm" class="text-red-700" onclick={() => removeOffering(o._id)}>
											Remove
										</Button>
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
