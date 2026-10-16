<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import { getBestPosition, haversineM } from '$lib/lams/geo';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { TriangleAlert } from '@lucide/svelte';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';

	interface RecordableOffering {
		_id: string;
		courseCode: string;
		courseTitle: string;
		programName: string;
	}

	/**
	 * Start a live attendance window from the scanning screen. Lecturers see
	 * their offerings; a program rep sees only offerings for programs they
	 * represent — the server enforces the same rule.
	 *
	 * `initialOfferingId` pre-selects a course, which is what lets the station
	 * screen put "start the next hour of this lecture" one tap away instead of
	 * making the rep find the same course in a list again.
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
	 * holds the previous suggestion. A course the rep picked themselves is
	 * never overwritten under them.
	 */
	let appliedSuggestion = '';
	$effect(() => {
		const suggested = initialOfferingId;
		if (!suggested || suggested === appliedSuggestion) return;
		if (offeringId === '' || offeringId === appliedSuggestion) offeringId = suggested;
		appliedSuggestion = suggested;
	});
	// The suggestion can arrive before the list (or name an offering this
	// viewer may not record for). A value with no matching item would render
	// as the raw id in the trigger, so drop it the moment the list is known.
	$effect(() => {
		if (offerings.length > 0 && offeringId && !offerings.some((o) => o._id === offeringId)) {
			offeringId = '';
		}
	});
	// One course, one choice: pre-select it so the lecturer only presses Start.
	$effect(() => {
		if (offerings.length === 1 && !offeringId) offeringId = offerings[0]._id;
	});
	let lat = $state('');
	let lng = $state('');
	// Where the screen itself stands. Left blank it follows the lecture
	// position, which is right for the ordinary case of both being in the room.
	let stationLat = $state('');
	let stationLng = $state('');
	/** GPS uncertainty of each fix above, when it came from a live reading. Typing clears it. */
	let pinAccuracy = $state<number | null>(null);
	let stationPinAccuracy = $state<number | null>(null);
	let radius = $state('50');
	// How far the screen may be carried from its spot before scanning stops.
	let tolerance = $state('15');
	let onTimeMin = $state('5');
	let lateUntilMin = $state('10');
	let locating = $state(false);
	let busy = $state(false);
	/**
	 * Second tap on Start with a coarse pin: the starter saw the warning and
	 * chose to proceed anyway. Reset whenever the position changes, so the
	 * acknowledgement never outlives the fix it was about.
	 */
	let confirmCoarse = $state(false);
	/** One-tap quick start: current location, 50 m radius enforced server-side. */
	let quickLocating = $state(false);
	let quickBusy = $state(false);
	let quickAccuracy = $state<number | null>(null);
	/** Best fix seen while sampling, shown under the button while locating. */
	let quickBest = $state<string | null>(null);
	let confirmQuickCoarse = $state(false);
	const quickTooCoarse = $derived(quickAccuracy !== null && quickAccuracy > 50);
	/**
	 * Metres from the sampled fix to where this course usually meets, when the
	 * usual room is known and the fix sits far from it. Armed by the pre-check
	 * below — or by the server refusing the start, which is the same warning
	 * arriving late.
	 */
	let quickFarM = $state<number | null>(null);
	let confirmFarPin = $state(false);
	const FAR_PIN_WARN_M = 500;

	/** Blank station fields mean "same as the lecture", so the API omits them. */
	const usesLectureSpot = $derived(stationLat.trim() === '' && stationLng.trim() === '');
	/**
	 * A pin captured from a fix coarser than the radius would fail the whole
	 * hall one scan at a time, so the server refuses it — this is the same
	 * check up front, with the way out spelt out (better fix or wider radius).
	 */
	const pinTooCoarse = $derived(pinAccuracy !== null && pinAccuracy > Number(radius));
	const stationTooCoarse = $derived(
		!usesLectureSpot && stationPinAccuracy !== null && stationPinAccuracy > Number(radius)
	);

	onMount(async () => {
		try {
			const client = requireConvexClient();
			const rows = (await client.query(api.attendance.listRecordableOfferings, {
				token
			})) as unknown as RecordableOffering[] | null;
			// `null` is the server saying the token is no longer accepted, which
			// is what a station screen left open past its session looks like.
			// There is nothing to list in that case, so sign out cleanly instead
			// of showing an empty course box the rep cannot explain.
			if (rows === null) {
				endSession();
				await goto('/signin');
				return;
			}
			offerings = rows;
		} catch (err) {
			reportError(err, 'Could not load your courses.');
		} finally {
			loading = false;
		}
	});

	async function useGps() {
		locating = true;
		try {
			// Best-of sampling, not one snapshot: the first fix indoors is
			// usually a stale or coarse one from wherever the phone last had
			// signal, and that is what pins a room kilometres off.
			const pos = await getBestPosition();
			lat = pos.lat.toFixed(6);
			lng = pos.lng.toFixed(6);
			pinAccuracy = pos.accuracyM ?? null;
			confirmCoarse = false;
			reportSuccess(
				`Using your current location as the lecture position (±${Math.round(pos.accuracyM ?? 0)} m).`,
				6000
			);
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
			const pos = await getBestPosition();
			stationLat = pos.lat.toFixed(6);
			stationLng = pos.lng.toFixed(6);
			stationPinAccuracy = pos.accuracyM ?? null;
			confirmCoarse = false;
			reportSuccess(
				`Station pinned to where you are standing (±${Math.round(pos.accuracyM ?? 0)} m).`,
				6000
			);
		} catch (err) {
			reportError(err, 'Could not read your location.');
		} finally {
			locating = false;
		}
	}

	/**
	 * One-tap start: samples the current position the hardened way (best fix
	 * over a few seconds, as student scans do) and lets the server enforce the
	 * 50 m radius, 15 m station tolerance and 5/10 min windows. No coordinates
	 * to type and no radius to choose — the ordinary lecture just starts.
	 *
	 * Two warnings can still stop the first tap: a fix coarser than the room,
	 * and a fix far from where this course usually meets (a stale fix from
	 * wherever the phone last had signal). Each takes a second, knowing tap to
	 * override — the server re-checks both and remains the authority.
	 */
	async function startQuick() {
		if (!offeringId || quickBusy || quickLocating) return;
		// A coarse fix would fail the whole hall one scan at a time, so the
		// first tap stops here and says so — the second tap is the starter
		// saying they saw the warning and accept the risk.
		if (quickTooCoarse && !confirmQuickCoarse) {
			confirmQuickCoarse = true;
			return;
		}
		if (quickFarM !== null && quickFarM > FAR_PIN_WARN_M && !confirmFarPin) {
			confirmFarPin = true;
			return;
		}
		quickLocating = true;
		quickBest = null;
		try {
			const pos = await getBestPosition({
				onFix: (fix) => {
					if (fix.accuracyM !== undefined) quickBest = `±${Math.round(fix.accuracyM)} m`;
				}
			});
			quickAccuracy = pos.accuracyM ?? null;
			if (quickAccuracy !== null && quickAccuracy > 50 && !confirmQuickCoarse) {
				confirmQuickCoarse = true;
				return;
			}
			if (!confirmFarPin) {
				const farM = await distanceFromUsualRoom(pos.lat, pos.lng);
				if (farM !== null && farM > FAR_PIN_WARN_M) {
					quickFarM = farM;
					return;
				}
				quickFarM = null;
			}
			quickBusy = true;
			try {
				const client = requireConvexClient();
				const res = (await client.mutation(api.attendance.startSessionQuick, {
					token,
					offeringId: offeringId as never,
					lectureLat: pos.lat,
					lectureLng: pos.lng,
					...(pos.accuracyM !== undefined ? { accuracyM: pos.accuracyM } : {}),
					...(confirmQuickCoarse ? { allowCoarsePin: true } : {}),
					...(confirmFarPin ? { allowFarPin: true } : {})
				})) as { sessionId: string };
				reportSuccess(
					`Lecture started here (±${Math.round(pos.accuracyM ?? 0)} m, 50 m radius).`,
					6000
				);
				await onstarted(res.sessionId);
			} finally {
				quickBusy = false;
			}
		} catch (err) {
			// The server re-checks the usual-room distance and remains the
			// authority: if it refused on those grounds, arm the same warning
			// the pre-check would have shown, so the next tap confirms it.
			if (/usually meets/i.test(err instanceof Error ? err.message : String(err))) {
				confirmFarPin = true;
			}
			reportError(err, 'Could not start the lecture.');
		} finally {
			quickLocating = false;
		}
	}

	/**
	 * Metres from a candidate pin to where the selected course usually meets,
	 * or null when the course has no history yet. Client-side courtesy only —
	 * the server enforces the same check on start.
	 */
	async function distanceFromUsualRoom(latNow: number, lngNow: number): Promise<number | null> {
		if (!offeringId) return null;
		try {
			const usual = (await requireConvexClient().query(api.attendance.usualMeetingPlace, {
				token,
				offeringId: offeringId as never
			})) as { lat: number; lng: number } | null;
			if (!usual) return null;
			return haversineM(usual.lat, usual.lng, latNow, lngNow);
		} catch {
			return null;
		}
	}

	function formatFarM(m: number): string {
		return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
	}

	async function start(e: SubmitEvent) {
		e.preventDefault();
		// A coarse pin would fail the whole hall one scan at a time, so the
		// first tap stops here and says so — the second tap is the starter
		// saying they saw the warning and accept the risk. The button itself
		// always works: a warning must never strand a lecture.
		if ((pinTooCoarse || stationTooCoarse) && !confirmCoarse) {
			confirmCoarse = true;
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.attendance.startSession, {
				token,
				offeringId: offeringId as never,
				lectureLat: Number(lat),
				lectureLng: Number(lng),
				...(pinAccuracy !== null ? { accuracyM: pinAccuracy } : {}),
				radiusM: Number(radius),
				stationRadiusM: Number(radius),
				stationToleranceM: Number(tolerance),
				// Omitted entirely when blank, so the server falls back to the
				// lecture position rather than being handed an empty coordinate.
				...(usesLectureSpot
					? {}
					: {
							stationLat: Number(stationLat),
							stationLng: Number(stationLng),
							...(stationPinAccuracy !== null ? { stationAccuracyM: stationPinAccuracy } : {})
						}),
				onTimeSec: Math.round(Number(onTimeMin) * 60),
				lateUntilSec: Math.round(Number(lateUntilMin) * 60),
				...(confirmCoarse ? { allowCoarsePin: true } : {}),
				...(confirmFarPin ? { allowFarPin: true } : {})
			})) as { sessionId: string };
			await onstarted(res.sessionId);
		} catch (err) {
			if (/usually meets/i.test(err instanceof Error ? err.message : String(err))) {
				confirmFarPin = true;
			}
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
			Choose the course, then press Start. Your current location becomes the lecture
			position with a 50 m radius — the station QR appears and students scan it from
			their own phones. Anyone not recorded when it closes is marked absent.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		{#if loading}
			<div class="h-16 animate-pulse rounded-md bg-muted"></div>
		{:else if offerings.length === 0}
			<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
				Nothing to start yet. Lecturers: offer courses to your programs first. Program reps: your
				lecturer can make you a rep of your program.
			</p>
		{:else}
			<div class="flex flex-col gap-4">
				<div class="flex flex-col gap-1.5">
					<Label for="soff">Course and program</Label>
					<Select.Root
						type="single"
						value={offeringId}
						onValueChange={(v) => {
							offeringId = v ?? '';
							quickFarM = null;
							confirmFarPin = false;
							confirmQuickCoarse = false;
						}}
						items={offerings.map((o) => ({
							value: o._id,
							label: `${o.courseCode} — ${o.courseTitle} · ${o.programName}`
						}))}
					>
						<Select.Trigger id="soff" class="w-full">
							<Select.Value placeholder="Choose a course" />
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each offerings as o (o._id)}
									<Select.Item
										value={o._id}
										label={`${o.courseCode} — ${o.courseTitle} · ${o.programName}`}
									>
										{o.courseCode} — {o.courseTitle} · {o.programName}
									</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				</div>

				<div class="rounded-md border border-lams-green/40 bg-lams-green/5 p-3">
					<p class="text-sm font-medium">Start here with your current location</p>
					<p class="mt-0.5 text-xs text-muted-foreground">
						50 m radius, on time for 5 minutes, then late until 10 minutes. No typing needed.
					</p>
					{#if quickAccuracy !== null}
						<p class="mt-1 text-xs text-muted-foreground">
							Last fix was accurate to ±{Math.round(quickAccuracy)} m.
						</p>
					{/if}
					{#if confirmQuickCoarse && quickTooCoarse}
						<p class="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
							This fix (±{Math.round(quickAccuracy ?? 0)} m) is coarser than the 50 m allowed
							distance, so starting now may mark students out of range. Press Start again to go
							ahead anyway, or use Advanced settings below to type the room's coordinates.
						</p>
					{/if}
					{#if confirmFarPin && quickFarM !== null && quickFarM > FAR_PIN_WARN_M}
						<p class="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
							This is {formatFarM(quickFarM)} from where this course usually meets — you may be
							pinning the wrong place (a stale location from outside the hall does this). Move
							into the hall and press Start again for a fresh fix, or press Start again to start
							here anyway because the lecture genuinely moved rooms.
						</p>
					{:else if confirmFarPin}
						<p class="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
							This is far from where this course usually meets. Press Start again to start here
							anyway because the lecture genuinely moved rooms — otherwise move into the hall
							and start again for a fresh fix.
						</p>
					{/if}
					{#if quickLocating && quickBest}
						<p class="mt-1 text-xs text-muted-foreground" aria-live="polite">
							Best fix so far {quickBest} — waiting a moment for it to settle.
						</p>
					{/if}
					<div class="mt-2">
						<Button
							type="button"
							disabled={!offeringId || quickBusy || quickLocating}
							onclick={startQuick}
						>
							{quickLocating
								? 'Reading your location…'
								: quickBusy
									? 'Starting…'
									: (confirmQuickCoarse && quickTooCoarse) || confirmFarPin
										? 'Start anyway (50 m)'
										: 'Start here — 50 m'}
						</Button>
					</div>
				</div>

				<details class="rounded-md border border-border">
					<summary class="cursor-pointer list-none px-3 py-2 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
						Advanced settings — type coordinates, move the screen, change timings
					</summary>
			<form class="flex flex-col gap-4 border-t border-border p-3" onsubmit={start}>

				<div class="rounded-md border border-border p-3">
					<p class="mb-2 text-sm font-medium">Where is the lecture?</p>
					<div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
						<div class="flex flex-col gap-1">
							<Label for="sla">Latitude</Label>
							<Input
								id="sla"
								bind:value={lat}
								oninput={() => {
									pinAccuracy = null;
									confirmCoarse = false;
								}}
								placeholder="-13.9626"
								required
							/>
						</div>
						<div class="flex flex-col gap-1">
							<Label for="slo">Longitude</Label>
							<Input
								id="slo"
								bind:value={lng}
								oninput={() => {
									pinAccuracy = null;
									confirmCoarse = false;
								}}
								placeholder="33.7741"
								required
							/>
						</div>
						<div class="flex items-end">
							<Button type="button" variant="outline" onclick={useGps} disabled={locating}>
								{locating ? 'Locating…' : 'Use my location'}
							</Button>
						</div>
					</div>
					{#if pinAccuracy !== null}
						<p class="mt-2 text-xs text-muted-foreground">
							This fix is accurate to ±{Math.round(pinAccuracy)} m.
						</p>
					{/if}
					{#if pinTooCoarse}
						<p class="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
							This fix (±{Math.round(pinAccuracy ?? 0)} m) is coarser than the {radius} m allowed
							distance, so starting now would mark students out of range. Wait for a better fix,
							move near a window or doorway, type the room's coordinates by hand, or widen the
							allowed distance below.
						</p>
					{/if}
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
							<Input
								id="sstlat"
								bind:value={stationLat}
								oninput={() => {
									stationPinAccuracy = null;
									confirmCoarse = false;
								}}
								placeholder="same as lecture"
							/>
						</div>
						<div class="flex flex-col gap-1">
							<Label for="sstlng">Station longitude</Label>
							<Input
								id="sstlng"
								bind:value={stationLng}
								oninput={() => {
									stationPinAccuracy = null;
									confirmCoarse = false;
								}}
								placeholder="same as lecture"
							/>
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
					{#if stationTooCoarse}
						<p class="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
							This screen fix (±{Math.round(stationPinAccuracy ?? 0)} m) is coarser than the {radius} m
							allowed distance. Wait for a better fix, type the screen's spot by hand, or widen the
							allowed distance below.
						</p>
					{/if}
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

				{#if confirmCoarse && (pinTooCoarse || stationTooCoarse)}
					<div
						class="rounded-md border border-amber-300 bg-amber-50 p-3"
						role="alert"
					>
						<p class="text-sm font-medium text-amber-900">Start anyway with this fix?</p>
						<p class="mt-1 text-xs text-amber-900">
							{#if pinTooCoarse}
								The lecture position is only accurate to ±{Math.round(pinAccuracy ?? 0)} m, which is
								coarser than the {radius} m allowed distance.
							{/if}
							{#if stationTooCoarse}
								The screen position is only accurate to ±{Math.round(stationPinAccuracy ?? 0)} m,
								which is coarser than the {radius} m allowed distance.
							{/if}
							Starting now may mark students out of range. Press Start lecture again to go ahead
							anyway, or improve the fix above first.
						</p>
					</div>
				{/if}

				{#if confirmFarPin}
					<div
						class="rounded-md border border-amber-300 bg-amber-50 p-3"
						role="alert"
					>
						<p class="text-sm font-medium text-amber-900">Start here anyway?</p>
						<p class="mt-1 text-xs text-amber-900">
							These coordinates are far from where this course usually meets. If the lecture
							genuinely moved rooms, press Start lecture again to go ahead. Otherwise check the
							coordinates above first — starting in the wrong place marks students out of range.
						</p>
					</div>
				{/if}

				<div>
					<Button type="submit" disabled={busy || !offeringId || !lat || !lng}>
						{busy ? 'Starting…' : confirmCoarse && (pinTooCoarse || stationTooCoarse) ? 'Start anyway' : confirmFarPin ? 'Start here anyway' : 'Start lecture'}
					</Button>
				</div>
			</form>
				</details>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
