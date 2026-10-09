<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import ProgramPicker from './program-picker.svelte';
	import type { ProgramRow, Semester } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	/**
	 * Enrol a whole program year at once: every member of the program gets
	 * every course placed for that year (optionally one semester). The
	 * new-intake case in one click; re-running only tops up the missing.
	 */
	let {
		token,
		programs,
		ondone
	}: {
		token: string;
		programs: ProgramRow[];
		ondone?: () => void | Promise<void>;
	} = $props();

	let open = $state(false);
	let programId = $state('');
	let year = $state('1');
	let semesterId = $state('all');
	let semesters = $state<Semester[]>([]);
	let busy = $state(false);

	const semestersOrdered = $derived(
		[...semesters].sort((a, b) => b.year - a.year || a.number - b.number)
	);
	const maxYears = $derived(
		programs.find((p) => p._id === programId)?.durationYears ?? 10
	);

	onMount(async () => {
		if (!token) return;
		try {
			const client = requireConvexClient();
			semesters = (await client.query(api.academics.listSemesters, { token })) as unknown as Semester[];
		} catch {
			semesters = [];
		}
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!programId) {
			reportError(new Error('No program.'), 'Choose the program to enrol.');
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.enrolments.enrolProgramYear, {
				token,
				programId: programId as never,
				yearOfStudy: Number(year),
				...(semesterId !== 'all' && semesterId ? { semesterId: semesterId as never } : {})
			})) as { students: number; courses: number; added: number; unchanged: number };
			await ondone?.();
			reportSuccess(
				`${res.added} enrolments added across ${res.students} students (${res.courses} courses).` +
					(res.unchanged > 0 ? ` ${res.unchanged} already had them.` : ''),
				8000
			);
		} catch (err) {
			reportError(err, 'Could not enrol that year.');
		} finally {
			busy = false;
		}
	}
</script>

<div class="rounded-md border border-border">
	<div class="flex flex-wrap items-center justify-between gap-2 p-3">
		<div>
			<p class="text-sm font-medium">Enrol a whole year at once</p>
			<p class="text-xs text-muted-foreground">
				Every student in the program gets every course placed for that year. Skips anyone who
				already has them.
			</p>
		</div>
		<Button size="sm" variant={open ? 'outline' : 'secondary'} onclick={() => (open = !open)}>
			{open ? 'Close' : 'Bulk enrol'}
		</Button>
	</div>
	{#if open}
		<form class="grid gap-3 border-t border-border p-3 sm:grid-cols-[1.4fr_0.6fr_1fr_auto]" onsubmit={submit}>
			<ProgramPicker {programs} bind:programId variant="select" id="be-program" />
			<div class="flex flex-col gap-1.5">
				<Label for="be-year">Year</Label>
				<Input id="be-year" type="number" min="1" max={maxYears} bind:value={year} required />
			</div>
			<div class="flex flex-col gap-1.5">
				<span class="text-sm font-medium">Semester</span>
				<Select.Root
					type="single"
					value={semesterId}
					onValueChange={(v) => (semesterId = v ?? 'all')}
					items={[
						{ value: 'all', label: 'All semesters' },
						...semestersOrdered.map((s) => ({ value: s._id, label: `${s.name} · ${s.year}` }))
					]}
				>
					<Select.Trigger id="be-semester" class="w-full">
						<Select.Value placeholder="All semesters" />
					</Select.Trigger>
					<Select.Content>
						<Select.Group>
							<Select.Item value="all" label="All semesters">All semesters</Select.Item>
							{#each semestersOrdered as s (s._id)}
								<Select.Item value={s._id} label={`${s.name} · ${s.year}`}>
									{s.name} · {s.year}
								</Select.Item>
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
			</div>
			<div class="flex items-end">
				<Button type="submit" disabled={busy || !programId}>
					{busy ? 'Enrolling…' : 'Enrol year'}
				</Button>
			</div>
		</form>
	{/if}
</div>
