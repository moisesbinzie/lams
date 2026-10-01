<script lang="ts">
	import { CalendarDate, parseDate } from '@internationalized/date';
	import * as Popover from '$lib/components/ui/popover';
	import { Calendar } from '$lib/components/ui/calendar';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import CalendarIcon from '@lucide/svelte/icons/calendar';

	let {
		value = $bindable(''),
		label,
		id
	}: {
		value: string;
		label?: string;
		id?: string;
	} = $props();

	let open = $state(false);
	let dateVal: CalendarDate | undefined = $state(value ? parseDate(value) : undefined);

	$effect(() => {
		if (dateVal) {
			value = dateVal.toString().slice(0, 10);
			open = false;
		}
	});

	function clear() {
		dateVal = undefined;
		value = '';
	}
</script>

<div class="flex flex-col gap-1.5">
	{#if label}<Label for={id}>{label}</Label>{/if}
	<div class="flex gap-1.5">
		<Popover.Root bind:open>
			<Popover.Trigger
				class="border-input bg-input/50 flex h-9 flex-1 items-center justify-start gap-2 rounded-3xl border px-3 text-sm"
			>
				<CalendarIcon class="size-4 shrink-0 opacity-60" />
				<span class={value ? '' : 'text-muted-foreground'}>
					{value || 'Pick a date'}
				</span>
			</Popover.Trigger>
			<Popover.Content class="w-auto p-0" align="start">
				<Calendar type="single" bind:value={dateVal} captionLayout="dropdown" />
			</Popover.Content>
		</Popover.Root>
		{#if value}
			<Button variant="ghost" size="sm" onclick={clear}>Clear</Button>
		{/if}
	</div>
	<input type="hidden" {id} {value} />
</div>
