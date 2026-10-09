<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import type { ProgramRow } from '$lib/lams/types';

	/**
	 * Program selector shared by every program-scoped panel.
	 *
	 * Two shapes on purpose:
	 *   - `chips` — every program visible as a button, for a short list where the
	 *     current choice should always be on screen;
	 *   - `select` — a dropdown, for the timetable and student filters where the
	 *     list can run to dozens and a row of chips would push the page down.
	 */
	let {
		programs,
		programId = $bindable(''),
		variant = 'chips',
		label = 'Program',
		emptyHint = 'No programs yet — create one first.',
		id,
		showCounts = false
	}: {
		programs: Pick<ProgramRow, '_id' | 'name' | 'studentCount' | 'courseCount'>[];
		programId?: string;
		variant?: 'chips' | 'select';
		label?: string;
		emptyHint?: string;
		id?: string;
		/** Show `· 12` (students) or `· 8 courses` next to each program. */
		showCounts?: false | 'students' | 'courses';
	} = $props();

	function suffix(p: (typeof programs)[number]): string {
		if (showCounts === 'students' && typeof p.studentCount === 'number') return ` · ${p.studentCount}`;
		if (showCounts === 'courses' && typeof p.courseCount === 'number') return ` · ${p.courseCount}`;
		return '';
	}
</script>

{#if programs.length === 0}
	<div class="flex flex-col gap-1.5">
		<span class="text-sm font-medium">{label}</span>
		<p class="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
			{emptyHint}
		</p>
	</div>
{:else if variant === 'select'}
	<div class="flex flex-col gap-1.5">
		<span class="text-sm font-medium">{label}</span>
		<Select.Root
			type="single"
			value={programId}
			onValueChange={(v) => (programId = v ?? '')}
			items={programs.map((p) => ({ value: p._id, label: `${p.name}${suffix(p)}` }))}
		>
			<Select.Trigger {id} class="w-full">
				<Select.Value placeholder="Choose a program" />
			</Select.Trigger>
			<Select.Content>
				<Select.Group>
					{#each programs as p (p._id)}
						<Select.Item value={p._id} label={`${p.name}${suffix(p)}`}>
							{p.name}{suffix(p)}
						</Select.Item>
					{/each}
				</Select.Group>
			</Select.Content>
		</Select.Root>
	</div>
{:else}
	<div class="flex flex-col gap-1.5">
		<span class="text-sm font-medium">{label}</span>
		<div class="flex flex-wrap gap-2" role="group" aria-label="Choose a program">
			{#each programs as p (p._id)}
				<Button
					variant="outline"
					size="sm"
					class="rounded-full {programId === p._id
						? 'border-lams-navy bg-lams-navy text-white hover:bg-lams-navy hover:text-white dark:bg-lams-navy'
						: ''}"
					aria-pressed={programId === p._id}
					onclick={() => (programId = p._id)}
				>
					{p.name}{suffix(p)}
				</Button>
			{/each}
		</div>
	</div>
{/if}
