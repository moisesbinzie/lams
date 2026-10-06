<script lang="ts">
	import {
		DateFormatter,
		getLocalTimeZone,
		parseDate,
		type CalendarDate,
		type DateValue
	} from '@internationalized/date';
	import * as Popover from '$lib/components/ui/popover';
	import { Calendar } from '$lib/components/ui/calendar';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import XIcon from '@lucide/svelte/icons/x';

	/**
	 * The app's single date control: shadcn Calendar inside a Popover, with a
	 * button trigger that matches every other control on the page.
	 *
	 * It speaks ISO `yyyy-mm-dd` in and out, because that is what the Convex
	 * functions take and what the CSV exports print. The `CalendarDate` the
	 * calendar itself works in never leaves this file — the bound string stays
	 * the one source of truth, so a page that resets its own filter (the
	 * attendance "Clear" button) empties the field here too.
	 *
	 * `onchange` exists because a bound string is not enough on its own: the
	 * attendance filters re-query the moment a date is picked, and an `$effect`
	 * on every keystroke of a parent would be a worse answer than a callback.
	 */
	let {
		value = $bindable(''),
		label,
		id,
		placeholder = 'Pick a date',
		disabled = false,
		required = false,
		clearable = true,
		onchange
	}: {
		/** ISO `yyyy-mm-dd`. Empty means "no date chosen". */
		value: string;
		label?: string;
		id?: string;
		placeholder?: string;
		disabled?: boolean;
		required?: boolean;
		clearable?: boolean;
		onchange?: (value: string) => void;
	} = $props();

	let open = $state(false);

	const formatter = new DateFormatter('en-GB', { dateStyle: 'medium' });

	/** A malformed string shows as "no date" rather than throwing. */
	const selected = $derived(toCalendarDate(value));
	const display = $derived(
		selected ? formatter.format(selected.toDate(getLocalTimeZone())) : placeholder
	);

	function toCalendarDate(iso: string): CalendarDate | undefined {
		if (!iso) return undefined;
		try {
			return parseDate(iso.slice(0, 10));
		} catch {
			return undefined;
		}
	}

	function pick(next: DateValue | undefined) {
		value = next ? next.toString().slice(0, 10) : '';
		open = false;
		onchange?.(value);
	}

	function clear() {
		pick(undefined);
	}
</script>

<div class="flex flex-col gap-1.5">
	{#if label}
		<Label for={id}>{label}</Label>
	{/if}
	<div class="flex items-center gap-1.5">
		<Popover.Root bind:open>
			<Popover.Trigger {id} {disabled}>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="outline"
						class="min-w-0 flex-1 justify-between font-normal"
						aria-required={required || undefined}
					>
						<CalendarIcon data-icon="inline-start" />
						<span class="truncate" class:text-muted-foreground={!selected}>{display}</span>
						<ChevronDownIcon data-icon="inline-end" />
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-auto overflow-hidden p-0" align="start">
				<Calendar type="single" value={selected} onValueChange={pick} captionLayout="dropdown" />
			</Popover.Content>
		</Popover.Root>
		{#if clearable && selected && !disabled}
			<Button variant="ghost" size="icon-sm" onclick={clear} aria-label="Clear the date">
				<XIcon />
			</Button>
		{/if}
	</div>
</div>
