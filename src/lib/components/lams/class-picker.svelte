<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import type { ProgramRow } from '$lib/lams/types';

	/**
	 * Program selector shared by every program-scoped panel. Renders the
	 * program as selectable chips so the current choice is always visible,
	 * even on a phone.
	 */
	let {
		programs,
		programId = $bindable(''),
		emptyHint = 'No programs yet — create one first.'
	}: {
		programs: Pick<ProgramRow, '_id' | 'name' | 'studentCount'>[];
		programId?: string;
		emptyHint?: string;
	} = $props();
</script>

<div class="flex flex-col gap-1.5">
	<span class="text-sm font-medium">Program</span>
	{#if programs.length === 0}
		<p class="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
			{emptyHint}
		</p>
	{:else}
		<div class="flex flex-wrap gap-2" role="group" aria-label="Choose a program">
			{#each programs as c (c._id)}
				<Button
					variant="outline"
					size="sm"
					class="rounded-full {programId === c._id
						? 'border-lams-navy bg-lams-navy text-white hover:bg-lams-navy hover:text-white dark:bg-lams-navy'
						: ''}"
					aria-pressed={programId === c._id}
					onclick={() => (programId = c._id)}
				>
					{c.name}
					{#if typeof c.studentCount === 'number'}
						<span class="opacity-70">· {c.studentCount}</span>
					{/if}
				</Button>
			{/each}
		</div>
	{/if}
</div>
