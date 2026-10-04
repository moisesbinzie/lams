<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import { getCurrentPosition } from '$lib/lams/geo';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { TriangleAlert } from '@lucide/svelte';

	interface RecordableOffering {
		_id: string;
		subjectCode: string;
		subjectTitle: string;
		className: string;
	}

	/**
	 * Start a live attendance window from the scanning screen. Lecturers see
	 * every offering; a class rep sees only offerings for classes they
	 * represent — the server enforces the same rule.
	 */
	let { onstarted }: { onstarted: (sessionId: string) => void | Promise<void> } = $props();

	let token = getToken();
	let offerings = $state<RecordableOffering[]>([]);
	let offeringId = $state('');
	let lat = $state('');
	let lng = $state('');
	let radius = $state('50');
	let onTimeMin = $state('5');
	let lateUntilMin = $state('10');
	let loading = $state(true);
	let locating = $state(false);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');

	onMount(async () => {
		try {
			const client = requireConvexClient();
			offerings = (await client.query(api.attendance.listRecordableOfferings, {
				token
			})) as unknown as RecordableOffering[];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load your subjects.';
		} finally {
			loading = false;
		}
	});

	async function useGps() {
		locating = true;
		error = '';
		try {
			const pos = await getCurrentPosition();
			lat = pos.lat.toFixed(6);
			lng = pos.lng.toFixed(6);
			notice = 'Using your current location as the lecture position.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not read your location.';
		} finally {
			locating = false;
		}
	}

	async function start(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		notice = '';
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.attendance.startSession, {
				token,
				offeringId: offeringId as never,
				lectureLat: Number(lat),
				lectureLng: Number(lng),
				radiusM: Number(radius),
				onTimeSec: Math.round(Number(onTimeMin) * 60),
				lateUntilSec: Math.round(Number(lateUntilMin) * 60)
			})) as { sessionId: string };
			await onstarted(res.sessionId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not start the lecture.';
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Start a lecture now</Card.Title>
		<Card.Description>
			Set where the lecture is and how long students have to arrive, then start scanning. Anyone not
			recorded when it closes is marked absent.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		{#if error}
			<p class="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800" role="alert">
				<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
				<span>{error}</span>
			</p>
		{/if}
		{#if notice}
			<p class="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900" role="status">{notice}</p>
		{/if}

		{#if loading}
			<div class="h-16 animate-pulse rounded-md bg-muted"></div>
		{:else if offerings.length === 0}
			<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
				Nothing to start yet. Lecturers: offer subjects to your classes first. Class reps: your
				lecturer can make you a rep of your class.
			</p>
		{:else}
			<form class="flex flex-col gap-4" onsubmit={start}>
				<div class="flex flex-col gap-1.5">
					<Label for="soff">Subject and class</Label>
					<select id="soff" class="w-full rounded-md border border-input bg-background p-2 text-sm" bind:value={offeringId}>
						{#each offerings as o (o._id)}
							<option value={o._id}>{o.subjectCode} — {o.subjectTitle} · {o.className}</option>
						{/each}
					</select>
				</div>

				<div class="rounded-md border border-border p-3">
					<p class="mb-2 text-sm font-medium">Where is the lecture?</p>
					<div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
						<div class="flex flex-col gap-1">
							<Label for="sla">Latitude</Label>
							<Input id="sla" bind:value={lat} placeholder="-13.9626" required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="slo">Longitude</Label>
							<Input id="slo" bind:value={lng} placeholder="33.7741" required />
						</div>
						<div class="flex items-end">
							<Button type="button" variant="outline" onclick={useGps} disabled={locating}>
								{locating ? 'Locating…' : 'Use my location'}
							</Button>
						</div>
					</div>
				</div>

				<div class="rounded-md border border-border p-3">
					<p class="mb-2 text-sm font-medium">Attendance rules</p>
					<div class="grid gap-2 sm:grid-cols-3">
						<div class="flex flex-col gap-1">
							<Label for="srad">Allowed distance (m)</Label>
							<Input id="srad" type="number" min="5" max="2000" bind:value={radius} />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="sont">On time for (min)</Label>
							<Input id="sont" type="number" min="0.5" max="60" step="0.5" bind:value={onTimeMin} />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="slat">Late until (min)</Label>
							<Input id="slat" type="number" min="1" max="120" step="0.5" bind:value={lateUntilMin} />
						</div>
					</div>
					<p class="mt-2 text-xs text-muted-foreground">
						On time for {onTimeMin} minute(s), then late until {lateUntilMin} minute(s). Anyone scanned
						after that is recorded as absent. Students more than {radius} m away are flagged for review.
					</p>
				</div>

				<div>
					<Button type="submit" disabled={busy || !offeringId || !lat || !lng}>
						{busy ? 'Starting…' : 'Start lecture'}
					</Button>
				</div>
			</form>
		{/if}
	</Card.Content>
</Card.Root>
