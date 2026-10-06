<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import { parseRosterCsv } from '$lib/lams/csv';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Table from '$lib/components/ui/table';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { UserRoundCheck } from '@lucide/svelte';
	import ClassPicker from './class-picker.svelte';
	import PersonEditDialog from './person-edit-dialog.svelte';
	import type { ClassRow, PersonRow } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	let token = getToken();
	let classes = $state<ClassRow[]>([]);
	let classId = $state('');
	let people = $state<PersonRow[]>([]);
	let repIds = $state<Set<string>>(new Set());
	let search = $state('');
	let showAdd = $state(false);
	let loading = $state(true);
	let busy = $state(false);

	// Add-student form.
	let newName = $state('');
	let newReg = $state('');
	let newSid = $state('');
	let pasteText = $state('');

	// Edit + confirm dialogs.
	let editing = $state<PersonRow | null>(null);
	let editOpen = $state(false);
	let suspendTarget = $state<PersonRow | null>(null);
	let suspendOpen = $state(false);

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

	onMount(async () => {
		if (!token) return;
		try {
			const client = requireConvexClient();
			classes = (await client.query(api.academics.listClasses, { token })) as unknown as ClassRow[];
			if (!classId && classes.length > 0) classId = classes[0]._id;
		} catch (err) {
			reportError(err, 'Could not load classes.');
		} finally {
			loading = false;
		}
	});

	async function loadPeople() {
		if (!classId) {
			people = [];
			return;
		}
		try {
			const client = requireConvexClient();
			const [rows, reps] = (await Promise.all([
				client.query(api.people.listPeople, { token, classId: classId as never }),
				client.query(api.reps.listForClass, { token, classId: classId as never })
			])) as [PersonRow[], { personId: string }[]];
			people = rows;
			repIds = new Set(reps.map((r) => r.personId));
		} catch (err) {
			reportError(err, 'Could not load students.');
		}
	}

	$effect(() => {
		if (classId) void loadPeople();
	});

	async function addPerson(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.people.createPerson, {
				token,
				fullName: newName.trim(),
				regNumber: newReg.trim(),
				studentId: newSid.trim(),
				role: 'student',
				classId: classId as never
			});
			newName = '';
			newReg = '';
			newSid = '';
			await loadPeople();
			reportSuccess('Student added. They can set their PIN the first time they sign in.');
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
		busy = true;
		try {
			const client = requireConvexClient();
			const res = await client.mutation(api.people.importPeople, {
				token,
				classId: classId as never,
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

	async function toggleRep(p: PersonRow) {
		const isRep = repIds.has(p._id);
		try {
			const client = requireConvexClient();
			await client.mutation(api.reps.setRep, {
				token,
				classId: classId as never,
				personId: p._id as never,
				isRep: !isRep
			});
			await loadPeople();
			reportSuccess(
				isRep
					? `${p.fullName} is no longer a class rep.`
					: `${p.fullName} can now take attendance for everything this class takes.`
			);
		} catch (err) {
			reportError(err, 'Could not change that.');
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
		<div class="h-24 animate-pulse rounded-md bg-muted"></div>
	{:else}
		<ClassPicker {classes} bind:classId emptyHint="No classes yet — add one in “Classes & semesters”." />

		{#if classId}
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex flex-wrap items-center gap-2">
						Students in this class
						{#if notSetUp > 0}
							<Badge class="bg-amber-600 text-white">{notSetUp} have not set a PIN yet</Badge>
						{/if}
					</Card.Title>
				<Card.Description>
					Only someone with this console can add students, so nobody can add themselves. A student
					who repeats a subject from another class can sit in both — use Edit to add the second
					class.
				</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-col gap-3">
					<div class="flex flex-wrap items-center gap-2">
						<Input
							class="max-w-xs flex-1"
							bind:value={search}
							placeholder="Search name, reg number or ID"
							aria-label="Search students"
						/>
						<Button size="sm" onclick={() => (showAdd = !showAdd)}>
							{showAdd ? 'Close' : 'Add students'}
						</Button>
					</div>

					{#if showAdd}
						<div class="flex flex-col gap-3 rounded-md border border-border p-3">
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
						</div>
					{/if}

					{#if filtered.length === 0}
						<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
							No students in this class yet. Add them above — anyone not recorded is marked absent.
						</p>
					{:else}
						<div class="overflow-x-auto rounded-md border">
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head>Name</Table.Head>
										<Table.Head>Registration number</Table.Head>
										<Table.Head>Student ID</Table.Head>
										<Table.Head>Status</Table.Head>
										<Table.Head class="text-right">Actions</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each filtered as p (p._id)}
										<Table.Row>
											<Table.Cell class="font-medium">
												<span class="flex items-center gap-1.5">
													{p.fullName}
													{#if repIds.has(p._id)}
														<Badge class="bg-lams-navy text-white">
															<UserRoundCheck class="size-3" aria-hidden="true" /> Rep
														</Badge>
													{/if}
												</span>
												{#if p.classIds.length > 1}
													<span class="block text-xs text-muted-foreground">
														Also in: {p.classIds
															.filter((id) => id !== classId)
															.map((id) => classes.find((c) => c._id === id)?.name)
															.filter(Boolean)
															.join(', ')}
													</span>
												{/if}
											</Table.Cell>
											<Table.Cell class="text-xs">{p.regNumber}</Table.Cell>
											<Table.Cell class="text-xs">{p.studentId}</Table.Cell>
											<Table.Cell>
												{#if p.status === 'active'}
													<Badge variant="secondary">Ready</Badge>
												{:else if p.status === 'invited'}
													<Badge class="bg-amber-600 text-white">No PIN yet</Badge>
												{:else}
													<Badge class="bg-red-600 text-white">Suspended</Badge>
												{/if}
											</Table.Cell>
											<Table.Cell class="text-right">
												<div class="flex flex-wrap justify-end gap-1">
													<Button
														variant={repIds.has(p._id) ? 'secondary' : 'outline'}
														size="sm"
														disabled={p.status === 'blocked'}
														onclick={() => toggleRep(p)}
													>
														{repIds.has(p._id) ? 'Remove rep' : 'Make rep'}
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onclick={() => {
															editing = p;
															editOpen = true;
														}}
													>
														Edit
													</Button>
													{#if p.status === 'active'}
														<Button
															variant="ghost"
															size="sm"
															class="text-red-700"
															onclick={() => {
																suspendTarget = p;
																suspendOpen = true;
															}}
														>
															Suspend
														</Button>
													{:else if p.status === 'blocked'}
														<Button variant="ghost" size="sm" onclick={() => {
															suspendTarget = p;
															suspendOpen = true;
														}}>Unblock</Button>
													{/if}
													{#if p.status !== 'blocked'}
														<Button variant="ghost" size="sm" onclick={() => resetPin(p._id)}>Reset PIN</Button>
													{/if}
													{#if p.hasDevice}
														<Button variant="ghost" size="sm" onclick={() => newPhone(p._id)}>New phone</Button>
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
	{/if}
</div>

<PersonEditDialog bind:open={editOpen} person={editing} {classes} {token} onsaved={loadPeople} />

<AlertDialog.Root bind:open={suspendOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				{suspendTarget?.status === 'blocked' ? `Unblock ${suspendTarget?.fullName}?` : `Suspend ${suspendTarget?.fullName}?`}
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
