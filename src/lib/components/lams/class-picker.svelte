<script lang="ts">
	import type { ClassRow } from '$lib/lams/types';

	/**
	 * Class selector shared by every class-scoped panel. Renders the class as
	 * selectable chips so the current choice is always visible, even on a phone.
	 */
	let {
		classes,
		classId = $bindable(''),
		emptyHint = 'No classes yet — create one first.'
	}: {
		classes: Pick<ClassRow, '_id' | 'name' | 'studentCount'>[];
		classId?: string;
		emptyHint?: string;
	} = $props();
</script>

<div class="flex flex-col gap-1.5">
	<span class="text-sm font-medium">Class</span>
	{#if classes.length === 0}
		<p class="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
			{emptyHint}
		</p>
	{:else}
		<div class="flex flex-wrap gap-2" role="group" aria-label="Choose a class">
			{#each classes as c (c._id)}
				<button
					type="button"
					class="rounded-full border px-3 py-1 text-sm transition-colors {classId === c._id
						? 'border-lams-navy bg-lams-navy text-white'
						: 'border-border text-foreground hover:bg-muted'}"
					aria-pressed={classId === c._id}
					onclick={() => (classId = c._id)}
				>
					{c.name}
					{#if typeof c.studentCount === 'number'}
						<span class="opacity-70">· {c.studentCount}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
