<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import { getCurrentPosition } from '$lib/lams/geo';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { TriangleAlert } from '@lucide/svelte';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

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
	 *
	 * `initialOfferingId` pre-selects a subject, which is what lets the station
	 * screen put "start the next hour of this lecture" one tap away instead of
	 * making the rep find the same subject in a list again.
	 */
	let {
		onstarted,
		initialOfferingId = ''
	}: {
		onstarted: (sessionId: string) => void | Promise<void>;
		initialOfferingId?: string;
	} = $props();

	let token = getToken();
	let offerings = $state<RecordableOffering[]>([]);
	let offeringId = $state('');
	let loading = $state(true);

	/**
	 * The suggestion rarely exists when this component mounts: the lecture list
	 * it comes from is still loading. So it is applied whenever it changes,
	 * which covers both arriving late and the running lecture being swapped for
	 * another one — but only while the selection is still untouched or still
	 * holds the previous suggestion. A subject the rep picked themselves is
	 * never overwritten under them.
	 */
	let appliedSuggestion = '';
	$effect(() => {
		const suggested = initialOfferingId;
		if (!suggested || suggested === appliedSuggestion) return;
		if (offeringId === '' || offeringId === appliedSuggestion) offeringId = suggested;
		appliedSuggestion = suggested;
	});
	let lat = $state('');
	let lng = $state('');
	// Where the screen itself stands. Left blank it follows the lecture
	// position, which is right for the ordinary case of both being in the room.
	let stationLat = $state('');
	let stationLng = $state('');
	let radius = $state('50');
	// How far the screen may be carried from its spot before scanning stops.
	let tolerance = $state('15');
	let onTimeMin = $state('5');
	let lateUntilMin = $state('10');
	let locating = $state(false);
	let busy = $state(false);

	/** Blank station fields mean "same as the lecture", so the API omits them. */
	const usesLectureSpot = $derived(stationLat.trim() === '' && stationLng.trim() === '');

	onMount(async () => {
		try {
			const client = requireConvexClient();
			const rows = (await client.query(api.attendance.listRecordableOfferings, {
				token
			})) as unknown as RecordableOffering[] | null;
			// `null` is the server saying the token is no longer accepted, which
			// is what a station screen left open past its session looks like.
			// There is nothing to list in that case, so sign out cleanly instead
			// of showing an empty subject box the rep cannot explain.
			if (rows === null) {
				endSession();
				await goto('/signin');
				return;
			}
			offerings = rows;
		} catch (err) {
			reportError(err, 'Could not load your subjects.');
		} finally {
			loading = false;
		}
	});

	async function useGps() {
		locating = true;
		try {
			const pos = await getCurrentPosition();
			lat = pos.lat.toFixed(6);
			lng = pos.lng.toFixed(6);
			reportSuccess('Using your current location as the lecture position.', 6000);
		} catch (err) {
			reportError(err, 'Could not read your location.');
		} finally {
			locating = false;
		}
	}

	/** Pin the station to wherever this device currently is. */
	async function fillStationWithGps() {
		locating = true;
		try {
			const pos = await getCurrentPosition();
			stationLat = pos.lat.toFixed(6);
			stationLng = pos.lng.toFixed(6);
			reportSuccess('Station pinned to where you are standing.', 6000);
		} catch (err) {
			reportError(err, 'Could not read your location.');
		} finally {
			locating = false;
		}
	}

	async function start(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.attendance.startSession, {
				token,
				offeringId: offeringId as never,
				lectureLat: Number(lat),
				lectureLng: Number(lng),
				radiusM: Number(radius),
				stationRadiusM: Number(radius),
				stationToleranceM: Number(tolerance),
				// Omitted entirely when blank, so the server falls back to the
				// lecture position rather than being handed an empty coordinate.
				...(usesLectureSpot ? {} : { stationLat: Number(stationLat), stationLng: Number(stationLng) }),
				onTimeSec: Math.round(Number(onTimeMin) * 60),
				lateUntilSec: Math.round(Number(lateUntilMin) * 60)
			})) as { sessionId: string };
			await onstarted(res.sessionId);
		} catch (err) {
			reportError(err, 'Could not start the lecture.');
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Start a lecture now</Card.Title>
		<Card.Description>
			Set where the lecture is and how long students have to arrive, then start. The station QR
			appears and students scan it from their own phones. Anyone not recorded when it closes is
			marked absent.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
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
					<Select.Root type="single" value={offeringId} onValueChange={(v) => (offeringId = v ?? '')}>
						<Select.Trigger id="soff" class="w-full">
							<Select.Value placeholder="Choose a subject" />
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each offerings as o (o._id)}
									<Select.Item value={o._id}>
										{o.subjectCode} — {o.subjectTitle} · {o.className}
									</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
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
					<p class="mb-2 text-sm font-medium">Where is the screen?</p>
					<p class="mb-2 text-xs text-muted-foreground">
						Leave these empty if the screen stands where the lecture is, which is nearly always the case.
						Fill them in only if the screen sits somewhere else, such as a doorway.
					</p>
					<div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
						<div class="flex flex-col gap-1">
							<Label for="sstlat">Station latitude</Label>
							<Input id="sstlat" bind:value={stationLat} placeholder="same as lecture" />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="sstlng">Station longitude</Label>
							<Input id="sstlng" bind:value={stationLng} placeholder="same as lecture" />
						</div>
						<div class="flex items-end">
							<Button
								type="button"
								variant="outline"
								disabled={locating}
								onclick={() => fillStationWithGps()}
							>
								Screen is where I am
							</Button>
						</div>
					</div>
					<div class="mt-2 flex flex-col gap-1 sm:max-w-40">
						<Label for="stol">Screen may move (m)</Label>
						<Input id="stol" type="number" min="1" max={radius} bind:value={tolerance} />
					</div>
					<p class="mt-2 text-xs text-muted-foreground">
						The screen checks it is still in this room. If it is carried more than {tolerance} m away,
						scanning stops and students are told why — nobody is marked absent because of it. Keep this small:
						it is about the screen staying put, not about students.
					</p>
				</div>

				<div class="rounded-md border border-border p-3">
					<p class="mb-2 text-sm font-medium">Attendance rules</p>
					<div class="grid gap-2 sm:grid-cols-3">
						<div class="flex flex-col gap-1">
							<Label for="srad">Station radius (m)</Label>
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
						On time for {onTimeMin} minute(s), then late until {lateUntilMin} minute(s). A student's own
						phone is accepted within {radius} m of the QR, and anything further off is flagged for
						review. Set this to the size of the room, not the campus.
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
