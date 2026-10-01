<script lang="ts">
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { parseRosterCsv } from '$lib/lams/csv';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import type { StudentDoc } from '$lib/lams/types';

	let { password, courseId }: { password: string; courseId: string } = $props();

	let students: StudentDoc[] = $state([]);
	let error = $state('');
	let busy = $state(false);
	let fullName = $state('');
	let regNumber = $state('');
	let studentId = $state('');
	let csvText = $state('');
	let importMsg = $state('');
	let search = $state('');

	const visible = $derived(
		students.filter((s) => {
			const q = search.trim().toLowerCase();
			if (!q) return true;
			return (
				s.fullName.toLowerCase().includes(q) ||
				s.regNumber.toLowerCase().includes(q) ||
				s.studentId.toLowerCase().includes(q)
			);
		})
	);

	async function load() {
		error = '';
		try {
			const client = requireConvexClient();
			students = (await client.query(api.students.listByCourse, { courseId: courseId as never })) as unknown as StudentDoc[];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load roster.';
		}
	}

	async function add(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.students.upsert, {
				password,
				courseId: courseId as never,
				fullName,
				regNumber,
				studentId
			});
			fullName = '';
			regNumber = '';
			studentId = '';
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Add failed.';
		} finally {
			busy = false;
		}
	}

	async function importCsv() {
		busy = true;
		error = '';
		importMsg = '';
		try {
			const rows = parseRosterCsv(csvText);
			if (rows.length === 0)
				throw new Error('No valid rows. Use: Full Name, Reg Number, Student ID per line.');
			const client = requireConvexClient();
			const res = await client.mutation(api.students.importBatch, {
				password,
				courseId: courseId as never,
				rows
			});
			csvText = '';
			await load();
			importMsg = `Imported ${res.added} new student(s); refreshed details for ${res.updated} existing one(s).`;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Import failed.';
		} finally {
			busy = false;
		}
	}

	async function toggleRep(s: StudentDoc) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.students.setClassRep, { password, studentId: s._id as never, isClassRep: !s.isClassRep });
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Update failed.';
		}
	}

	async function removeStudent(id: string) {
		if (!confirm('Remove this student from the roster?')) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.students.remove, { password, id: id as never });
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Remove failed.';
		}
	}

	$effect(() => {
		if (courseId) load();
	});
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Step 3 — Roster ({students.length} students)</Card.Title>
		<Card.Description>
			Register every student here first: add one by one, or paste CSV lines
			<em>Full Name, Reg Number, Student ID</em>. Flag class reps with “Set rep”.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		<form class="grid gap-2 md:grid-cols-4" onsubmit={add}>
			<Input bind:value={fullName} placeholder="Full name" aria-label="Full name" required />
			<Input bind:value={regNumber} placeholder="Reg number" aria-label="Reg number" required />
			<Input bind:value={studentId} placeholder="Student ID" aria-label="Student ID" required />
			<Button type="submit" disabled={busy}>Add student</Button>
		</form>
		<div class="flex flex-col gap-2">
			<label class="text-xs text-muted-foreground" for="csv">Bulk import — one student per line</label>
			<textarea
				id="csv"
				class="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
				bind:value={csvText}
				placeholder="Amina Banda, BIT/2024/0123, 2024-0123"
			></textarea>
			<div class="flex gap-2">
				<Button variant="secondary" size="sm" onclick={importCsv} disabled={busy}>
					{busy ? 'Importing…' : 'Import CSV'}
				</Button>
				<Button variant="outline" size="sm" onclick={load}>Refresh</Button>
			</div>
			{#if importMsg}<p class="text-xs text-emerald-700">{importMsg}</p>{/if}
		</div>
		{#if error}<p class="text-sm text-red-700" role="alert">{error}</p>{/if}
		<div class="flex flex-wrap items-center gap-2">
			<Input
				class="max-w-xs flex-1"
				bind:value={search}
				placeholder="Search roster…"
				aria-label="Search roster"
			/>
			<span class="text-xs text-muted-foreground">
				{visible.length === students.length
					? `${students.length} students`
					: `showing ${visible.length} of ${students.length}`}
			</span>
		</div>
		{#if students.length === 0}
			<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
				No students yet. Add the class list above — sessions count Absent against this roster.
			</p>
		{:else if visible.length === 0}
			<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
				No students match “{search}”.
			</p>
		{:else}
			<div class="max-h-80 overflow-auto rounded-md border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Reg</Table.Head>
							<Table.Head>ID</Table.Head>
							<Table.Head>Role</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each visible as s (s._id)}
							<Table.Row>
								<Table.Cell class="font-medium">{s.fullName}</Table.Cell>
								<Table.Cell>{s.regNumber}</Table.Cell>
								<Table.Cell>{s.studentId}</Table.Cell>
								<Table.Cell>
									{#if s.isClassRep}<Badge>Class rep</Badge>{:else}<span class="text-xs text-muted-foreground">Student</span>{/if}
								</Table.Cell>
								<Table.Cell class="text-right">
									<div class="flex justify-end gap-1">
										<Button variant="outline" size="sm" onclick={() => toggleRep(s)}>
											{s.isClassRep ? 'Unset rep' : 'Set rep'}
										</Button>
										<Button variant="ghost" size="sm" onclick={() => removeStudent(s._id)}>Remove</Button>
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
