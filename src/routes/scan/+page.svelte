<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import { formatCountdown, formatDistance, getCurrentPosition } from '$lib/lams/geo';
	import {
		buildStationUrl,
		currentStationCode,
		secondsRemaining,
		STATION_PERIOD_SEC
	} from '$lib/lams/station';
	import { qrDataUrl } from '$lib/lams/qr';
	import StartSessionForm from '$lib/components/lams/start-session-form.svelte';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import {
		ChevronDown,
		Maximize,
		Pencil,
		TriangleAlert,
		Users
	} from '@lucide/svelte';
	import type { AttendanceRecord, LectureSession, StationFeed } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';
	import { sessionMe } from '$lib/lams/session.svelte';
	import LecturerNav from '$lib/components/lams/lecturer-nav.svelte';
	import StudentNav from '$lib/components/lams/student-nav.svelte';

	let token = $state('');
	let sessions = $state<LectureSession[]>([]);
	/**
	 * This screen is shared: lecturers open it from their console and class
	 * reps from the station job. The in-page strip follows the viewer — the
	 * lecturer sections for staff, the student's own sections for a rep, who
	 * otherwise has no way back to their account once the top bar drops its
	 * links on a phone.
	 */
	const viewer = $derived(sessionMe());
	let live = $state<StationFeed | null>(null);
	let records = $state<AttendanceRecord[]>([]);
	let busy = $state(false);
	let now = $state(Date.now());
	let origin = $state('');

	// Hand-add / override panel
	type Status = 'Present' | 'Late' | 'Excused' | 'Absent';
	/** Adding a record by hand never writes Absent — only a correction can. */
	type AddedStatus = Exclude<Status, 'Absent'>;
	let manualReg = $state('');
	let manualStatus = $state<AddedStatus>('Present');
	let manualReason = $state('');
	let roster = $state<{ regNumber: string; label: string }[]>([]);
	let editingId = $state<string | null>(null);
	let editStatus = $state<Status>('Present');

	// Station display
	let qrImg = $state('');
	let fullscreen = $state(false);
	let panel: HTMLDivElement | null = $state(null);
	/**
	 * How the server currently judges this screen's own position. Reported by
	 * `reportPosition` below rather than polled, so the banner appears the moment
	 * the station is found to have left its room instead of up to five seconds
	 * later when the record list happens to refresh.
	 */
	let placement = $state<{
		moved: boolean;
		unverified: boolean;
		distanceM: number | null;
		toleranceM: number;
	}>({ moved: false, unverified: false, distanceM: null, toleranceM: 0 });
	let repinLat = $state('');
	let repinLng = $state('');
	let repinReason = $state('');
	let repinning = $state(false);

	/**
	 * How often the screen tells the server where it is.
	 *
	 * Matched to the code's rotation so the two clocks line up: by the time a
	 * photographed code has expired, the station has also proved it was still in
	 * the room. Tied to the period rather than a literal, so shortening the
	 * rotation tightens this with it instead of letting the two drift apart.
	 */
	const PLACEMENT_INTERVAL_MS = STATION_PERIOD_SEC * 1000;

	/**
		 * Every hand-entered record carries a reason, so these are the ones that
		 * actually happen. Offered as a datalist rather than a fixed set: the field
		 * stays free text for the cases that do not fit.
		 */
		const REASONS = [
			'No phone',
			'Phone broken or lost',
			'Camera would not focus on the screen',
			'Location would not load',
			'Lecture moved to another room',
			'Station was pinned in the wrong room',
			'Present in person, rep confirmed',
			'Scanner read the wrong student'
		];

		const flagged = $derived(records.filter((r) => r.flagged));
	const closed = $derived(live ? live.status === 'closed' || now >= live.closesAt : true);
	const remaining = $derived(secondsRemaining(now));

	/**
	 * A lecture is only usable while the server says it is open *and* its window
	 * has not run out. The list survives a browser left open past the end of a
	 * lecture, so the two have to be checked together rather than trusting the
	 * stored status alone.
	 */
	function isOpen(s: LectureSession): boolean {
		return s.status === 'open' && now < s.closesAt;
	}

	// Most recently started first, so the lecture a rep is most likely to want
	// is the one at the top of the list.
	const byNewest = (a: LectureSession, b: LectureSession) => b.startedAt - a.startedAt;
	const openNow = $derived(sessions.filter(isOpen).sort(byNewest));
	const past = $derived(sessions.filter((s) => !isOpen(s)).sort(byNewest));
	const current = $derived(openNow[0] ?? null);

	/**
	 * Starting a lecture is the main job on this screen, so the subject is
	 * pre-answered when there is only one lecture it could be. With several
	 * running side by side the rep has to say which, rather than the screen
	 * guessing and quietly closing the wrong one.
	 */
	const suggestedOfferingId = $derived(
		openNow.length === 1 && openNow[0].offeringId ? openNow[0].offeringId : ''
	);

	/**
	 * The code rolling every few seconds is the whole anti-sharing mechanism, so
	 * the screen has to stay legible at a distance — hence full screen, the code
	 * in large type as well as the QR for anyone whose camera will not focus, and
	 * the countdown so the room can see it is live rather than a printout.
	 */
	const stationCode = $derived(live?.secret ? currentStationCode(live.secret, now) : '');
	const stationUrl = $derived(
		live?.secret && origin ? buildStationUrl(origin, live._id, currentStationCode(live.secret, now)) : ''
	);

	onMount(() => {
		token = getToken();
		origin = window.location.origin;
		if (!token) {
			void goto('/signin');
			return;
		}
		void loadSessions();
		const tick = setInterval(() => (now = Date.now()), 1000);
		const poll = setInterval(() => {
			if (live && live.status === 'open') void loadRecords();
		}, 5000);
		const placementPoll = setInterval(() => void reportPosition(), PLACEMENT_INTERVAL_MS);
		// Report straight away rather than waiting out the first interval, so a
		// station that was carried in from another room is caught before the first
		// student arrives rather than half a minute after.
		if (live && live.status === 'open') void reportPosition();
		const onFs = () => (fullscreen = !!document.fullscreenElement);
		document.addEventListener('fullscreenchange', onFs);
		return () => {
			clearInterval(tick);
			clearInterval(poll);
			clearInterval(placementPoll);
			document.removeEventListener('fullscreenchange', onFs);
		};
	});

	/** Re-render the QR only when the code actually rolls, not on every tick. */
	$effect(() => {
		const url = stationUrl;
		if (!url) {
			qrImg = '';
			return;
		}
		void qrDataUrl(url, 512).then((img) => {
			qrImg = img;
		});
	});

	async function loadSessions() {
		try {
			const client = requireConvexClient();
			sessions = (await client.query(api.attendance.listForRecordKeeper, {
				token
			})) as unknown as LectureSession[];
		} catch (err) {
			reportError(err, 'Could not load your lectures.');
		}
	}

	/**
	 * Opening a lecture whose window has already run out closes it on the way in,
	 * which is what writes the Absent rows. Doing it here rather than leaving the
	 * rep staring at a station that refuses every scan is the difference between
	 * a usable record and a queue of confused students.
	 *
	 * Closing is destructive — it settles absences — so it is confirmed first.
	 */
	async function openSession(id: string) {
		const target = sessions.find((s) => s._id === id);
		if (target && target.status === 'open' && now >= target.closesAt) {
			const when = new Date(target.closesAt).toLocaleTimeString();
			if (
				!confirm(
					`${target.subjectCode}'s window ended at ${when}. Close it now and mark everyone not recorded absent?`
				)
			) {
				return;
			}
			try {
				const client = requireConvexClient();
				const res = await client.mutation(api.attendance.closeSession, {
					token,
					sessionId: id as never
				});
				reportSuccess(`Lecture closed. ${res.absentAdded} student(s) marked absent.`);
				await loadSessions();
			} catch (err) {
				reportError(err, 'Could not close that lecture.');
			}
			return;
		}

		try {
			const client = requireConvexClient();
			const feed = await client.query(api.attendance.stationFeed, {
				token,
				sessionId: id as never
			});
			live = feed as unknown as StationFeed | null;
			if (live) {
				now = Date.now();
				// Seed the banner from the server rather than from a stale local
				// report, so reopening a session that was moved while closed shows
				// the truth immediately.
				placement = {
					moved: live.stationMoved,
					unverified: live.stationUnverified,
					distanceM: live.stationSeenDistanceM,
					toleranceM: live.stationToleranceM
				};
				repinLat = String(live.stationLat);
				repinLng = String(live.stationLng);
				await Promise.all([loadRecords(), loadRoster()]);
			}
		} catch (err) {
			live = null;
			reportError(err, 'Could not open that lecture.');
		}
	}

	async function loadRoster() {
		if (!live) return;
		try {
			const client = requireConvexClient();
			const rows = (await client.query(api.enrolments.listForOffering, {
				token,
				offeringId: live._id as never
			})) as unknown as { fullName: string; regNumber: string }[];
			roster = rows
				.filter((r) => r.regNumber)
				.map((r) => ({ regNumber: r.regNumber, label: `${r.fullName} (${r.regNumber})` }));
		} catch {
			roster = [];
		}
	}

	async function loadRecords() {
		if (!live) return;
		try {
			const client = requireConvexClient();
			records = (await client.query(api.attendance.listBySession, {
				token,
				sessionId: live._id as never
			})) as unknown as AttendanceRecord[];
		} catch {
			// Keep the last known list rather than blanking the screen mid-lecture.
		}
	}

	async function extend(extraMin: number) {
		if (!live) return;
		try {
			const client = requireConvexClient();
			const res = await client.mutation(api.attendance.extendSession, {
				token,
				sessionId: live._id as never,
				extraSec: extraMin * 60
			});
			live = { ...live, closesAt: res.closesAt, status: 'open' };
			reportSuccess(`Window extended by ${extraMin} minute(s).`);
		} catch (err) {
			reportError(err, 'Could not extend the window.');
		}
	}

	/** Fill the re-pin fields with this device's position. */
	async function useGpsForRepin() {
		try {
			const pos = await getCurrentPosition();
			repinLat = String(pos.lat);
			repinLng = String(pos.lng);
		} catch (err) {
			reportError(err, 'Could not read your location.');
		}
	}

	/**
	 * Tell the server where this screen is, and remember its answer.
	 *
	 * A missing fix is not reported as a failure. A rep whose browser refuses
	 * location entirely should still be able to run the lecture, so the screen
	 * just goes on saying nothing — the server treats silence as "cannot check",
	 * never as "moved".
	 */
	async function reportPosition() {
		if (!live || live.status !== 'open') return;
		try {
			const pos = await getCurrentPosition();
			const res = (await requireConvexClient().mutation(api.stationplace.reportStationPosition, {
				token,
				sessionId: live._id as never,
				latitude: pos.lat,
				longitude: pos.lng,
				...(pos.accuracyM !== undefined ? { accuracyM: pos.accuracyM } : {})
			})) as { moved: boolean; unverified: boolean; distanceM: number | null; toleranceM: number };
			placement = res;
		} catch {
			// Offline, permission refused, or the lecture closed under us. The
			// previous verdict stands rather than being reset — an unverifiable
			// reading is not evidence that the station came back.
		}
	}

	/**
	 * Move the station's pinned room. The escape hatch for a lecture that
	 * genuinely changed rooms, or a pin that was set wrongly to begin with.
	 * Always needs a reason, because "trust me" is exactly the claim this
	 * feature exists to check.
	 */
	async function repin(e: SubmitEvent) {
		e.preventDefault();
		if (!live) return;
		repinning = true;
		try {
			await requireConvexClient().mutation(api.stationplace.pinStation, {
				token,
				sessionId: live._id as never,
				latitude: Number(repinLat),
				longitude: Number(repinLng),
				reason: repinReason.trim()
			});
			placement = { ...placement, moved: false, unverified: false, distanceM: 0 };
			repinReason = '';
			reportSuccess('Station pinned to this room. Scans are working again.');
			await openSession(live._id);
		} catch (err) {
			reportError(err, 'Could not move the station.');
		} finally {
			repinning = false;
		}
	}

	async function toggleFullscreen() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await panel?.requestFullscreen();
		} catch {
			toast.error('Full screen is not available in this browser.');
		}
	}

	/**
	 * The phone-less path. A rep or lecturer enters the student by hand and the
	 * record is tagged with who entered it and why, so it is never mistaken for a
	 * scanned one later.
	 */
	async function addByHand(e: SubmitEvent) {
		e.preventDefault();
		if (!live) return;
		if (!manualReason.trim()) {
			toast.error('Say why this student was added by hand — it is kept on the record.');
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			let lat: number | undefined;
			let lng: number | undefined;
			try {
				const pos = await getCurrentPosition();
				lat = pos.lat;
				lng = pos.lng;
			} catch {
				// The rep's own position is only a note about where they were
				// standing; the record stands without it.
			}
			await client.mutation(api.attendance.addManually, {
				token,
				sessionId: live._id as never,
				regNumber: manualReg.trim(),
				status: manualStatus,
				reason: manualReason.trim(),
				...(lat !== undefined ? { latitude: lat } : {}),
				...(lng !== undefined ? { longitude: lng } : {})
			});
			manualReg = '';
			manualReason = '';
			reportSuccess('Student added by hand.');
			await loadRecords();
		} catch (err) {
			reportError(err, 'Could not add that student.');
		} finally {
			busy = false;
		}
	}

	async function saveOverride() {
		if (!editingId) return;
		if (!manualReason.trim()) {
			toast.error('Say why this record is being changed — it is kept on the record.');
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.attendance.overrideDuringSession, {
				token,
				attendanceId: editingId as never,
				status: editStatus,
				reason: manualReason.trim()
			});
			editingId = null;
			manualReason = '';
			reportSuccess('Record updated.');
			await loadRecords();
		} catch (err) {
			reportError(err, 'Could not change that record.');
		} finally {
			busy = false;
		}
	}

	async function closeLecture() {
		if (!live) return;
		if (!confirm('Close this lecture now? Anyone not recorded will be marked absent.')) return;
		try {
			const client = requireConvexClient();
			const res = await client.mutation(api.attendance.closeSession, {
				token,
				sessionId: live._id as never
			});
			reportSuccess(`Lecture closed. ${res.absentAdded} student(s) marked absent.`);
			await loadSessions();
			await loadRecords();
		} catch (err) {
			reportError(err, 'Could not close the lecture.');
		}
	}
</script>

<div class="flex flex-col gap-6">
	{#if viewer?.kind === 'staff'}
		<LecturerNav />
	{:else if viewer?.kind === 'person'}
		<StudentNav />
	{/if}
	<div class="text-center">
		<h1 class="text-2xl font-bold text-lams-navy">Take attendance</h1>
		<p class="text-sm text-muted-foreground">
			Put this screen at the front of the hall. Students scan it with their own phones.
		</p>
	</div>

	{#if !live}
		<!--
			Living room order: what is happening now, then what you came here to
			do, then the archive. The history used to be the first thing on this
			screen and the reason the page read as a list to browse rather than a
			tool to pick up mid-lecture.
		-->
		{#if current}
			<Card.Root class="border-lams-green/40 bg-lams-green/5">
				<Card.Content class="flex flex-wrap items-center justify-between gap-3 pt-6">
					<div>
						<p class="flex items-center gap-2 text-sm font-semibold text-lams-navy">
							<span class="inline-block size-2 shrink-0 animate-pulse rounded-full bg-lams-green" aria-hidden="true"></span>
							A lecture is running now
						</p>
						<p class="mt-1 text-xs text-muted-foreground">
							{current.subjectCode} — {current.subjectTitle} · {current.className} · closes in {formatCountdown(
								current.closesAt - now
							)}
						</p>
					</div>
					<Button size="sm" onclick={() => openSession(current._id)}>Back to the station</Button>
				</Card.Content>
			</Card.Root>
		{/if}

		<StartSessionForm onstarted={(id) => openSession(id)} initialOfferingId={suggestedOfferingId} />

		<Card.Root>
			<Card.Content class="pt-6">
				<!--
					The chevron is the affordance, not decoration: laying the summary
					out with flex removes the browser's own disclosure marker, so
					without it "Past lectures" read as a heading rather than the door
					to the sessions already recorded. It turns as the list opens, and
					the row picks up a hover tint so a mouse finds it too.
				-->
				<details class="group">
					<summary
						class="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-3xl px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
					>
						<span class="flex items-center gap-2">
							<ChevronDown
								class="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
								aria-hidden="true"
							/>
							Past lectures
						</span>
						<span class="text-xs font-normal text-muted-foreground">
							{sessions.length === 0
								? 'nothing here yet'
								: `${sessions.length} recent ${sessions.length === 1 ? 'record' : 'records'} · open one to review or correct it`}
						</span>
					</summary>
					<div class="mt-3">
						{#if sessions.length === 0}
							<p
								class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground"
							>
								No lectures recorded yet. Start one above.
							</p>
						{:else}
							<ul class="flex max-h-96 flex-col divide-y divide-border overflow-y-auto">
								{#each [...openNow, ...past] as s (s._id)}
									<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
										<span>
											<strong>{s.subjectCode}</strong> — {s.subjectTitle}
											<span class="block text-xs text-muted-foreground">
												{s.className} · {new Date(s.startedAt).toLocaleString()}
											</span>
										</span>
										<span class="flex items-center gap-2">
											<StatusBadge status={isOpen(s) ? 'open' : 'closed'} />
											<Button variant="outline" size="sm" onclick={() => openSession(s._id)}>
												{isOpen(s) ? 'Open' : 'Review'}
											</Button>
										</span>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				</details>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Content class="flex flex-wrap items-center justify-between gap-3 pt-6">
				<div>
					<p class="font-semibold">{live.subjectCode} — {live.subjectTitle}</p>
					<p class="text-xs text-muted-foreground">
						{live.className}
						{#if !closed}· closes in {formatCountdown(live.closesAt - now)}{/if}
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					{#if !closed}
						<Button variant="outline" size="sm" onclick={() => extend(5)}>+5 min</Button>
						<Button variant="outline" size="sm" onclick={() => extend(10)}>+10 min</Button>
					{/if}
					<Button variant="outline" size="sm" onclick={() => (live = null)}>Change lecture</Button>
					{#if !closed}
						<Button variant="secondary" size="sm" onclick={closeLecture}>Close lecture</Button>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>

		<!--
			The station's own room check. Two states, deliberately kept visually
			different in weight: red means scans are being refused right now, amber
			means the check could not run and is proving nothing.

			Red is shown even when the rep is the one who moved the screen, because
			a rep who does not notice has left a queue of students scanning a dead
			QR with no idea why.
		-->
		{#if !closed && placement.moved}
			<Card.Root class="border-red-300 bg-red-50">
				<Card.Header>
					<Card.Title class="flex items-center gap-2 text-base text-red-900">
						<TriangleAlert class="size-4" aria-hidden="true" /> This screen has left its room — scanning is
						stopped
					</Card.Title>
					<Card.Description class="text-red-900">
						{#if placement.distanceM !== null}
							It is {formatDistance(placement.distanceM)} from where it was set up, which is further than the
							{placement.toleranceM} m it is allowed to move. Students are not being marked present until this
							is put back, so nobody is recorded as absent because of it.
						{:else}
							It has been reported outside the room it belongs to. Students are not being marked present until
							this is put back.
						{/if}
					</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-col gap-3">
					<p class="text-sm font-medium">Put it back in the room</p>
					<p class="text-xs text-muted-foreground">
						Walking it back to its spot clears this on the next check. If the lecture really has moved rooms,
						pin it to the new room instead — the reason is kept on the record.
					</p>
					<details>
						<summary class="cursor-pointer text-sm font-medium text-lams-navy">
							The lecture moved rooms — pin it here instead
						</summary>
						<form class="mt-3 flex flex-col gap-3" onsubmit={repin}>
							<div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
								<div class="flex flex-col gap-1">
									<Label for="rinlat">Room latitude</Label>
									<Input id="rinlat" bind:value={repinLat} required />
								</div>
								<div class="flex flex-col gap-1">
									<Label for="rinlng">Room longitude</Label>
									<Input id="rinlng" bind:value={repinLng} required />
								</div>
								<div class="flex items-end">
									<Button type="button" variant="outline" onclick={useGpsForRepin}>
										Use my location
									</Button>
								</div>
							</div>
							<div class="flex flex-col gap-1">
								<Label for="rinwhy">Why it is moving (required)</Label>
								<Input
									id="rinwhy"
									bind:value={repinReason}
									list="lams-reasons"
									placeholder="e.g. Lecture moved to Room 4"
									required
								/>
							</div>
							<div>
								<Button type="submit" disabled={repinning}>
									{repinning ? 'Moving…' : 'Pin to this room'}
								</Button>
							</div>
						</form>
					</details>
				</Card.Content>
			</Card.Root>
		{:else if !closed && placement.unverified}
			<Card.Root class="border-amber-300 bg-amber-50">
				<Card.Content class="flex flex-col gap-1 py-4">
					<p class="flex items-center gap-2 text-sm font-medium text-amber-900">
						<TriangleAlert class="size-4" aria-hidden="true" /> Location unavailable on this screen
					</p>
					<p class="text-xs text-amber-900">
						LAMS cannot confirm this screen is still in its room, so scanning carries on unchecked. Turn on
						location for this browser to have the check working.
					</p>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if closed}
			<Card.Root>
				<Card.Content class="flex flex-col items-center gap-2 py-8 text-center">
					<StatusBadge status="closed" size="lg" />
					<p class="text-sm font-medium">This lecture is closed.</p>
					<p class="text-sm text-muted-foreground">
						No more students can be recorded. Anyone you need to correct has to be changed by a lecturer.
					</p>
				</Card.Content>
			</Card.Root>
		{:else if placement.moved}
			<!--
				No QR while the station is out of its room. The server refuses these
				scans anyway; hiding the code saves a queue of students photographing
				a screen that will never work.
			-->
			<div
				class="flex flex-col items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-8 text-center"
			>
				<TriangleAlert class="size-8 text-red-600" aria-hidden="true" />
				<p class="text-lg font-semibold text-red-900">Scanning is stopped</p>
				<p class="max-w-sm text-sm text-red-900">
					Put this screen back in the room, or pin it to the new one above. Scans start working again on its
					own.
				</p>
			</div>
		{:else if stationUrl}
			<div
				bind:this={panel}
				class="flex flex-col items-center gap-4 rounded-lg border border-border p-5 {fullscreen
					? 'fixed inset-0 z-50 m-0 justify-center overflow-auto bg-white p-8'
					: ''}"
			>
				<img
					src={qrImg}
					alt="Attendance QR code for this lecture"
					class="rounded-lg bg-white {fullscreen ? 'max-h-[55vh] w-auto' : 'h-auto w-80 max-w-full'}"
				/>
				<p class="text-center">
					<span class="block text-4xl font-bold tracking-[0.3em] text-lams-navy">{stationCode}</span>
					<span class="text-xs text-muted-foreground">Scan this with your phone's camera</span>
				</p>
				<div class="w-full max-w-xs">
					<div
						class="h-1.5 w-full overflow-hidden rounded-full bg-muted"
						role="progressbar"
						aria-label="Time until this code refreshes"
						aria-valuemin="0"
						aria-valuemax={STATION_PERIOD_SEC}
						aria-valuenow={remaining}
					>
						<div
							class="h-full rounded-full bg-lams-green transition-[width] duration-1000"
							style={`width: ${(remaining / STATION_PERIOD_SEC) * 100}%`}
						></div>
					</div>
					<p class="mt-1 text-center text-xs text-muted-foreground" aria-live="polite">
						New code in {remaining}s — a photo of this screen stops working after that
					</p>
				</div>
				<Button variant="outline" size="sm" onclick={toggleFullscreen}>
					<Maximize class="size-3.5" /> {fullscreen ? 'Exit full screen' : 'Full screen'}
				</Button>
			</div>
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title>Student has no phone, or needs a record changed</Card.Title>
				<Card.Description>
					Records entered here are marked as entered by hand, with your name and your reason against them.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				{#if editingId}
					<form class="flex flex-col gap-3" onsubmit={saveOverride}>
						<p class="text-sm font-medium">Change this record to</p>
						<div class="flex flex-wrap items-end gap-3">
							<div class="flex flex-col gap-1">
								<Label for="estatus">Status</Label>
								<Select.Root
									type="single"
									value={editStatus}
									onValueChange={(v) => (editStatus = (v ?? 'Present') as Status)}
								>
									<Select.Trigger id="estatus" class="w-full">
										<Select.Value placeholder="Present" />
									</Select.Trigger>
									<Select.Content>
										<Select.Group>
											<Select.Item value="Present">Present</Select.Item>
											<Select.Item value="Late">Late</Select.Item>
											<Select.Item value="Excused">Excused</Select.Item>
											<Select.Item value="Absent">Absent</Select.Item>
										</Select.Group>
									</Select.Content>
								</Select.Root>
							</div>
							<div class="flex min-w-48 flex-1 flex-col gap-1">
								<Label for="ereason">Reason (required)</Label>
								<Input
									id="ereason"
									bind:value={manualReason}
									list="lams-reasons"
									placeholder="e.g. Location would not load"
									required
								/>
							</div>
							<Button type="submit" disabled={busy}>Save</Button>
							<Button type="button" variant="ghost" onclick={() => (editingId = null)}>Cancel</Button>
						</div>
					</form>
				{:else if !closed}
					<form class="grid gap-3 sm:grid-cols-[2fr_1fr_auto]" onsubmit={addByHand}>
						<div class="flex flex-col gap-1">
							<Label for="mreg">Registration number</Label>
							<Input
								id="mreg"
								bind:value={manualReg}
								list="scan-roster"
								placeholder="Type a name or reg number"
								required
							/>
							<datalist id="scan-roster">
								{#each roster as r (r.regNumber)}
									<option value={r.regNumber}>{r.label}</option>
								{/each}
							</datalist>
						</div>
						<div class="flex flex-col gap-1">
							<Label for="mstatus">Status</Label>
							<Select.Root
								type="single"
								value={manualStatus}
								onValueChange={(v) => (manualStatus = (v ?? 'Present') as AddedStatus)}
							>
								<Select.Trigger id="mstatus" class="w-full">
									<Select.Value placeholder="Present" />
								</Select.Trigger>
								<Select.Content>
									<Select.Group>
										<Select.Item value="Present">Present</Select.Item>
										<Select.Item value="Late">Late</Select.Item>
										<Select.Item value="Excused">Excused</Select.Item>
									</Select.Group>
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex items-end">
							<Button type="submit" disabled={busy}>Add</Button>
						</div>
						<div class="sm:col-span-3">
							<Label for="mreason">Reason (required)</Label>
							<Input
								id="mreason"
								bind:value={manualReason}
								list="lams-reasons"
								placeholder="e.g. No phone"
								required
							/>
						</div>
					</form>
					<p class="text-xs text-muted-foreground">
						Start typing to pick from the class roster. They must already be enrolled in this subject.
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">
						This lecture is closed, so no new records can be added. A lecturer can still correct anything
						wrong from the lecture history.
					</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<datalist id="lams-reasons">
					{#each REASONS as r (r)}
						<option value={r}></option>
					{/each}
				</datalist>

				{#if flagged.length > 0}
			<Card.Root class="border-amber-300 bg-amber-50">
				<Card.Header>
					<Card.Title class="text-base">Needs checking ({flagged.length})</Card.Title>
					<Card.Description>
						These records were still created, but something about them did not add up.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<ul class="flex flex-col gap-2">
						{#each flagged as r (r._id)}
							<li class="text-sm">
								<strong>{r.fullName}</strong>
								<span class="block text-xs text-amber-900">{r.flagReason}</span>
								{#if !closed}
									<Button
										variant="ghost"
										size="sm"
										onclick={() => {
											editingId = r._id;
											editStatus = 'Present';
										}}
									>
										<Pencil class="size-3.5" /> Mark present anyway
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<Users class="size-4" aria-hidden="true" /> Recorded so far ({records.length})
				</Card.Title>
				<Card.Description>
					Students appear here as they scan. Anything that needs changing, you can change while this lecture
					is open.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if records.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						Nobody has scanned yet.
					</p>
				{:else}
					<ul class="flex flex-col divide-y divide-border">
						{#each records as r (r._id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-2">
								<span class="text-sm">
									<strong>{r.fullName}</strong>
									<span class="block text-xs text-muted-foreground">
										{r.regNumber}
										· {new Date(r.submittedAt).toLocaleTimeString()}
										{#if r.method === 'station'}
											· scanned at the station
											{#if r.studentDistanceM !== null}· {r.studentDistanceM} m from it{/if}
										{:else if r.method === 'rep' || r.method === 'manual'}
											· added by {r.recordedBy ?? 'a rep'}
											{#if r.overrideReason}· “{r.overrideReason}”{/if}
										{:else if r.recordedBy}
											· via {r.recordedBy}
										{/if}
										{#if r.verification === 'weak'}· location too imprecise to judge{/if}
										{#if r.verification === 'unconfirmed'}· no location reported{/if}
										{#if r.overriddenBy}· changed by {r.overriddenBy}{/if}
									</span>
								</span>
								<span class="flex items-center gap-2">
									<StatusBadge status={r.status} />
									{#if !closed && r.method !== 'absent' && r.status !== 'Excused'}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => {
												editingId = r._id;
												editStatus = 'Present';
											}}
											aria-label={`Change ${r.fullName}'s record`}
										>
											<Pencil class="size-3.5" /> Change
										</Button>
									{/if}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>