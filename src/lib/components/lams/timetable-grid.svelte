<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import {
		clashingMeetingIds,
		columnLayout,
		DEFAULT_WINDOW,
		rowLabel,
		rowStarts,
		slotBox,
		SLOT_MINUTES,
		type GridWindow,
		type SlotLike
	} from '$lib/lams/grid';
	import type { TimetableSlot } from '$lib/lams/types';
	import { TriangleAlert } from '@lucide/svelte';

	/**
	 * The timetable as a spreadsheet: days across the top, quarter hours down
	 * the side, each lecture drawn where it actually falls in the week.
	 *
	 * Deliberately dumb. It lays out what it is given and reports clicks; it
	 * fetches nothing and saves nothing. All the arithmetic lives in `$lib/lams/grid`
	 * where it is unit-tested, and every write happens in the panel's slot dialog.
	 *
	 * It is also deliberately not a real table element. A timetable's rows are
	 * time, not records, and 7 × 56 cells of `<td>` would be 392 elements that
	 * announce nothing useful to a screen reader. Instead each quarter-hour is a
	 * labelled button, and the lectures float above them as positioned blocks.
	 */
	let {
		slots,
		window: gridWindow = DEFAULT_WINDOW,
		rowHeight = 22,
		onpick,
		onslot
	}: {
		slots: TimetableSlot[];
		window?: GridWindow;
		rowHeight?: number;
		/** An empty quarter hour was clicked — open the "add a slot" dialog here. */
		onpick?: (day: number, startTime: string) => void;
		/** An existing lecture was clicked — open it for editing. */
		onslot?: (slot: TimetableSlot) => void;
	} = $props();

	const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	/** Teaching weeks start on Monday; Sunday is shown but last. */
	const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

	const starts = $derived(rowStarts(gridWindow, SLOT_MINUTES));
	const totalRows = $derived(starts.length);
	const gridHeight = $derived(totalRows * rowHeight);
	const clashes = $derived(clashingMeetingIds(slots as SlotLike[]));
	const layout = $derived(columnLayout(slots as SlotLike[]));

	/** Blocks positioned once, so the markup below stays readable. */
	const blocks = $derived(
		slots
			.map((slot) => {
				const box = slotBox(slot.startTime, slot.endTime, gridWindow, SLOT_MINUTES);
				if (!box) return null;
				const place = layout.get(slot.meetingId) ?? { column: 0, width: 1 };
				return { slot, box, place, clashing: clashes.has(slot.meetingId) };
			})
			.filter((b): b is NonNullable<typeof b> => b !== null)
	);

	function cellLabel(day: number, minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
		return `${DAYS[day]} at ${clock} — add a lecture`;
	}
</script>

<div class="flex flex-col gap-2">
	<div class="flex flex-wrap items-center gap-2">
		{#if clashes.size > 0}
			<Badge class="bg-amber-600 text-white">
				<TriangleAlert class="size-3" aria-hidden="true" />
				{clashes.size} slot{clashes.size === 1 ? '' : 's'} overlap
			</Badge>
		{:else}
			<Badge variant="secondary">No overlaps</Badge>
		{/if}
		<span class="text-xs text-muted-foreground">
			Click an empty cell to add a lecture, or a lecture to change or remove it.
		</span>
	</div>

	<div class="overflow-x-auto rounded-md border border-border">
		<div class="min-w-[46rem]">
			<!-- Header: a spacer over the time gutter, then the days. -->
			<div
				class="sticky top-0 z-20 grid border-b border-border bg-muted/80 backdrop-blur"
				style:grid-template-columns="3.5rem repeat(7, minmax(0, 1fr))"
			>
				<div class="px-2 py-2 text-xs font-medium text-muted-foreground">Time</div>
				{#each DAY_ORDER as day (day)}
					<div class="border-l border-border px-2 py-2 text-center text-xs font-semibold">
						{DAYS[day].slice(0, 3)}
					</div>
				{/each}
			</div>

			<div
				class="grid"
				style:grid-template-columns="3.5rem repeat(7, minmax(0, 1fr))"
				style:height="{gridHeight}px"
			>
				<!-- Time gutter -->
				<div class="relative border-r border-border bg-muted/30">
					{#each starts as minutes (minutes)}
						<div
							class="border-b border-border/40 px-2 text-[0.65rem] leading-none text-muted-foreground"
							style:height="{rowHeight}px"
						>
							{#if rowLabel(minutes)}
								<span class="relative -top-0.5">{rowLabel(minutes)}</span>
							{/if}
						</div>
					{/each}
				</div>

				<!-- One column per day: clickable quarter-hour cells, then the blocks. -->
				{#each DAY_ORDER as day (day)}
					<div class="relative border-l border-border">
						{#each starts as minutes (minutes)}
							<button
								type="button"
								class="block w-full border-b border-border/40 transition-colors hover:bg-lams-navy/5 focus-visible:bg-lams-navy/10 focus-visible:outline-none"
								style:height="{rowHeight}px"
								aria-label={cellLabel(day, minutes)}
								onclick={() => onpick?.(day, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`)}
							></button>
						{/each}

						{#each blocks.filter((b) => b.slot.dayOfWeek === day) as block (block.slot.meetingId)}
							{@const widthPct = 100 / block.place.width}
							{@const leftPct = widthPct * block.place.column}
							<button
								type="button"
								class="absolute z-10 overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[0.65rem] leading-tight transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {block.clashing
									? 'border-amber-500 bg-amber-100 text-amber-950'
									: 'border-lams-navy/40 bg-lams-navy/10 text-lams-navy'}"
								style:top="{(block.box.startRow - 1) * rowHeight + 1}px"
								style:height="{block.box.spanRows * rowHeight - 2}px"
								style:left="calc({leftPct}% + 2px)"
								style:width="calc({widthPct}% - 4px)"
								title={`${block.slot.courseCode} ${block.slot.startTime}–${block.slot.endTime}${block.slot.room ? ` · Room ${block.slot.room}` : ''}`}
								onclick={() => onslot?.(block.slot)}
							>
								<span class="flex items-center gap-1 font-semibold">
									{#if block.clashing}
										<TriangleAlert class="size-3 shrink-0" aria-hidden="true" />
									{/if}
									<span class="truncate">{block.slot.courseCode}</span>
								</span>
								<span class="block truncate opacity-80">
									{block.slot.startTime}–{block.slot.endTime}{block.slot.room
										? ` · ${block.slot.room}`
										: ''}
								</span>
								{#if block.box.spanRows > 3}
									<span class="block truncate opacity-70">
										Y{block.slot.yearOfStudy ?? '—'} · {block.slot.courseTitle}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>

	{#if blocks.length === 0}
		<p class="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
			Nothing on the grid yet. Click any cell to place the first lecture of the week.
		</p>
	{/if}
</div>
