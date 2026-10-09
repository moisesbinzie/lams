<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import CourseEditDialog from './subject-edit-dialog.svelte';
	import OfferingRosterDialog from './offering-roster-dialog.svelte';
	import OfferingTree from './offering-tree.svelte';
	import type { ProgramRow, Offering, Course } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';
	import { sessionMe } from '$lib/lams/session.svelte';

	let token = getToken();
	let programs = $state<ProgramRow[]>([]);
	let courses = $state<Course[]>([]);
	let loading = $state(true);
	let busy = $state(false);
	// Bumps to remount the tree (refreshing its counts) after roster changes.
	let treeKey = $state(0);

	// New course form.
	let code = $state('');
	let title = $state('');
	let hours = $state('3');

	// Dialogs.
	let editing = $state<Course | null>(null);
	let editOpen = $state(false);
	let removing = $state<Course | null>(null);
	let removeOpen = $state(false);
	let rosterFor = $state<Offering | null>(null);
	let rosterOpen = $state(false);

	const me = $derived(sessionMe());
	const isAdmin = $derived(me?.kind === 'staff' && (me.isAdmin === true || me.role === 'admin'));

	onMount(async () => {
		if (!token) return;
		try {
			const client = requireConvexClient();
			const [progs, crs] = (await Promise.all([
				client.query(api.academics.listPrograms, { token }),
				client.query(api.academics.listCourses, { token })
			])) as [ProgramRow[], Course[]];
			programs = progs;
			courses = crs;
		} catch (err) {
			reportError(err, 'Could not load courses.');
		} finally {
			loading = false;
		}
	});

	async function createCourse(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.createCourse, {
				token,
				code: code.trim(),
				title: title.trim(),
				hoursPerWeek: Number(hours) || undefined
			});
			code = '';
			title = '';
			courses = (await client.query(api.academics.listCourses, { token })) as unknown as Course[];
			treeKey += 1;
			reportSuccess('Course saved to the catalogue. Offer it to a program in the structure below.');
		} catch (err) {
			reportError(err, 'Could not save the course.');
		} finally {
			busy = false;
		}
	}

	async function removeCourseConfirmed() {
		if (!removing) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.removeCourse, { token, id: removing._id as never });
			courses = (await client.query(api.academics.listCourses, { token })) as unknown as Course[];
			treeKey += 1;
			reportSuccess(`${removing.code} removed from the catalogue.`);
		} catch (err) {
			reportError(err, 'Could not remove the course.');
		} finally {
			removeOpen = false;
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
					<span>{isAdmin ? 'Course catalogue' : 'My courses'}</span>
				</Card.Title>
				<Card.Description>
					{isAdmin
						? 'A course is saved once with its code — e.g. BIT 221 — and can then be offered to any program.'
						: 'Courses assigned to you by the admin.'}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{#if isAdmin}
					<form class="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto]" onsubmit={createCourse}>
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
							<Button type="submit" disabled={busy}>Add course</Button>
						</div>
					</form>
				{/if}

				{#if courses.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						{isAdmin ? 'The catalogue is empty. Add the first course above.' : 'No courses assigned to you yet.'}
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
								{#each courses as s (s._id)}
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
				<Card.Title>{isAdmin ? 'Teaching structure' : 'My teaching'}</Card.Title>
				<Card.Description>
					{isAdmin
						? 'Semester → program year → offered course, with its lecturer. Offer courses and assign lecturers right here.'
						: 'Your programs and the courses you teach in them, grouped by year.'}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#key treeKey}
					<OfferingTree
						{token}
						mode={isAdmin ? 'admin' : 'mine'}
						onroster={(o) => {
							rosterFor = o;
							rosterOpen = true;
						}}
					/>
				{/key}
			</Card.Content>
		</Card.Root>
	{/if}
</div>

<CourseEditDialog bind:open={editOpen} course={editing} {token} onsaved={async () => {
	courses = (await requireConvexClient().query(api.academics.listCourses, { token })) as unknown as Course[];
	treeKey += 1;
}} />

<OfferingRosterDialog
	bind:open={rosterOpen}
	offering={rosterFor}
	{programs}
	{token}
	onchanged={() => {
		treeKey += 1;
	}}
/>

<AlertDialog.Root bind:open={removeOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove {removing?.code} from the catalogue?</AlertDialog.Title>
				<AlertDialog.Description>
					This only works while no program is taking the course.
				</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={removeCourseConfirmed}>Remove</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
