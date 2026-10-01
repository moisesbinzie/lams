<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import {
		CircleCheck,
		CircleMinus,
		CircleX,
		Clock3,
		DoorClosed,
		DoorOpen,
		MapPinOff,
		type LucideIcon
	} from '@lucide/svelte';
	import type { AttendanceStatus } from '$lib/lams/types';

	let {
		status,
		size = 'md'
	}: { status: AttendanceStatus | 'open' | 'closed' | string; size?: 'sm' | 'md' | 'lg' } = $props();

	// Colours follow the LAMS logo legend: Present ✅ / Absent ❌ / Late 🕐 /
	// Excused ⊖, plus MapPinOff for Out of Range.
	const map: Record<string, { label: string; klass: string; Icon: LucideIcon }> = {
		Present: { label: 'Present', klass: 'bg-emerald-700 text-white', Icon: CircleCheck },
		Late: { label: 'Late', klass: 'bg-amber-400 text-amber-950', Icon: Clock3 },
		Out_of_Range: { label: 'Out of Range', klass: 'bg-rose-700 text-white', Icon: MapPinOff },
		Absent: { label: 'Absent', klass: 'bg-neutral-600 text-white', Icon: CircleX },
		Excused: { label: 'Excused', klass: 'bg-sky-700 text-white', Icon: CircleMinus },
		open: { label: 'Session open', klass: 'bg-emerald-700 text-white', Icon: DoorOpen },
		closed: { label: 'Session closed', klass: 'bg-neutral-600 text-white', Icon: DoorClosed }
	};

	const entry = $derived(map[String(status)]);
	const sizeClass = $derived(
		size === 'sm' ? 'gap-1 px-2 py-0.5 text-[11px]' : size === 'lg' ? 'gap-2 px-3 py-1 text-sm' : 'gap-1.5'
	);
</script>

<Badge class="{entry?.klass ?? ''} {sizeClass} font-medium">
	{#if entry}
		<entry.Icon class={size === 'lg' ? 'size-4' : 'size-3.5'} aria-hidden="true" />
		{entry.label}
	{:else}
		{String(status).replace(/_/g, ' ')}
	{/if}
</Badge>

