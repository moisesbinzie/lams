<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getDeviceId, getToken } from '$lib/lams/auth';
	import { ensureSession, endSession, sessionStatus } from '$lib/lams/session.svelte';
	import { formatDistance, getCurrentPosition } from '$lib/lams/geo';
	import { stashPendingScan, takePendingScan } from '$lib/lams/station';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { CircleCheck, CircleSlash, CircleX, MapPin, MapPinCheck, TriangleAlert } from '@lucide/svelte';
	import type { StationPreview, StationScanResult } from '$lib/lams/types';
	import { explainError, isNotEnrolled } from '$lib/lams/errors';
	import { reportSerious } from '$lib/lams/notify.svelte';
	import StudentNav from '$lib/components/lams/student-nav.svelte';

	/**
	 * A refusal that a fresh code can fix: the station code rolled before the scan
	 * reached the server. Matched on the server's wording ("That station code has
	 * expired. Scan the screen again.") the same way `isNotEnrolled` is.
	 */
	const RECOVERABLE = /expired|not valid/i;

	let sessionId = $derived(page.params.sessionId ?? '');
	/**
	 * Writable, not derived: the code is normally the `?c=` query parameter, but a
	 * student who had to be sent through sign-in gets it back from sessionStorage
	 * instead, and `code` is written in both cases.
	 */
	let code = $state('');

	type Stage = 'checking' | 'signin' | 'ready' | 'locating' | 'done' | 'failed' | 'not_enrolled';

	let stage = $state<Stage>('checking');
	let error = $state('');
	let preview = $state<StationPreview | null>(null);
	let result = $state<StationScanResult | null>(null);
	let locationNote = $state('');
		let codeExpired = $state(false);
	/** The screen has left its room, so the refusal is not the student's to fix. */
	let stationMoved = $state(false);
	let now = $state(Date.now());
	/**
	 * The "you are not enrolled" toast is shown once per visit. The card below it
	 * stays put, so a second toast on a retry would add nothing.
	 */
	let enrolmentWarned = $state(false);
	/** Set once a stale scan has been recovered with a fresh code, to say so. */
	let staleRecovered = $state(false);

	/** One toast, then the persistent card that tells them what to do about it. */
	function warnNotEnrolled(): void {
		if (enrolmentWarned) return;
		enrolmentWarned = true;
		reportSerious(
			new Error('You are not enrolled in this subject yet, so this scan was not recorded.'),
			''
		);
	}

	const closed = $derived(preview ? preview.status === 'closed' || now >= preview.closesAt : false);
	const expiresIn = $derived(preview ? Math.max(0, preview.closesAt - now) : 0);

	onMount(() => {
		let alive = true;
		const tick = setInterval(() => (now = Date.now()), 1000);

		void (async () => {
			// The code lives in the query string, and it will not survive a redirect
			// through sign-in. Hold onto it first so a signed-out student's scan is
			// not lost on the way to the form.
			code = page.url.searchParams.get('c') ?? '';
			if (code) stashPendingScan(sessionId, code);

			await ensureSession();
			if (!alive) return;

			if (sessionStatus() !== 'authed') {
				stage = 'signin';
				return;
			}

			const restored = takePendingScan(sessionId) ?? code;
			if (!restored) {
				error = 'That code is missing. Scan the screen at the front of the hall again.';
				stage = 'failed';
				return;
			}
			code = restored;

			try {
				const client = requireConvexClient();
				const info = await client.query(api.attendance.stationPreview, {
					token: getToken(),
					sessionId: sessionId as never
				});
				if (!alive) return;
				if (!info) {
					error = 'This lecture could not be found.';
					stage = 'failed';
					return;
				}
				preview = info as unknown as StationPreview;
				stage = 'ready';
				// Refused before the location prompt, not after it: asking a
				// student for a position fix and then telling them they were never
				// going to be recorded is the worst order to do these in. The
				// server re-checks on submit and remains the authority.
				if (!preview.viewerEnrolled) {
					stage = 'not_enrolled';
					warnNotEnrolled();
					return;
				}
				// Scan-and-go: the browser asks for location straight away, because
				// the distance check is the point of the whole scheme.
				void submit();
			} catch (err) {
				if (!alive) return;
				// Inline for the same reason as the scan failure below: this drives
				// the failed card the student is left looking at.
				error = explainError(err) || 'Could not open that lecture.';
				stage = 'failed';
			}
		})();

		return () => {
			alive = false;
			clearInterval(tick);
		};
	});

	/**
	 * The code in the URL is the one that was on screen when the QR was read, and
	 * it stops verifying after its slot and the two neighbours — up to 90 seconds.
	 * A sign-in round trip, a cold PWA start or a slow location fix on a bad
	 * connection can easily outlast that, so a scan that has gone stale is
	 * recovered rather than refused: the server hands back the code the screen is
	 * showing *now*, and the scan is submitted again with it.
	 *
	 * Once only. A second stale code means something else is wrong, and looping
	 * would hide that behind a spinner.
	 */
	async function submit() {
		if (stage === 'locating' || stage === 'done' || stage === 'not_enrolled') return;
		stage = 'locating';
		error = '';
		locationNote = '';
		codeExpired = false;
		staleRecovered = false;
		stationMoved = false;

		let pos: { lat: number; lng: number; accuracyM?: number } | null = null;
		try {
			pos = await getCurrentPosition();
		} catch (err) {
			// The scan still goes through without a position. It is recorded as
			// unconfirmed and flagged rather than silently counted as present.
			//
			// This stays inline rather than becoming a toast: it is quoted back to the
			// student on the result card, telling them what their phone actually said,
			// so it has to survive until they read it.
			locationNote = explainError(err) || 'Your location could not be read on this device.';
		}

		const client = requireConvexClient();
		/** One attempt with whatever code is currently held. */
		const attempt = () =>
			client.mutation(api.attendance.submitStationScan, {
				token: getToken(),
				sessionId: sessionId as never,
				code,
				// Sent so the server can prove the scan came from the phone this
				// account is bound to, not a phone someone carried the token to.
				deviceId: getDeviceId(),
				...(pos ? { latitude: pos.lat, longitude: pos.lng } : {}),
				...(pos?.accuracyM !== undefined ? { accuracyM: pos.accuracyM } : {})
			});

		let retriedFreshCode = false;
		try {
			for (;;) {
				try {
					result = (await attempt()) as unknown as StationScanResult;
					stage = 'done';
					return;
				} catch (err) {
					const message = explainError(err) || 'That scan could not be recorded.';

					// An expired or moved token is not the student's problem to solve
					// here — send them through sign-in and the scan finishes itself.
					if (/sign in again|different phone|moved to another phone/i.test(message)) {
						endSession();
						if (code) stashPendingScan(sessionId, code);
						stage = 'signin';
						return;
					}

					// The whole point of this loop. Retrying the *same* code would fail
					// identically, so a fresh one is fetched instead — and if it cannot
					// be had, the failure below is the honest answer.
					if (!retriedFreshCode && RECOVERABLE.test(message)) {
						retriedFreshCode = true;
						let fresh: { code: string } | null = null;
						try {
							fresh = (await client.query(api.attendance.currentCode, {
								token: getToken(),
								sessionId: sessionId as never
							})) as { code: string } | null;
						} catch {
							// Offline, rate-limited, or the token went stale under us. The
							// card below says what happened; a recovery that itself failed
							// is still just a failed scan.
							fresh = null;
						}
						if (fresh?.code) {
							code = fresh.code;
							staleRecovered = true;
							continue;
						}
					}

					error = message;
					// Enrolment can be dropped between the preview and the scan, so
					// this path is reachable even though the preview checks first.
					if (isNotEnrolled(message)) {
						stage = 'not_enrolled';
						warnNotEnrolled();
						return;
					}
					stage = 'failed';
					// A stale code is the one failure the student cannot fix by trying
					// again: the code in the URL is the one that rolled. Retrying it
					// would fail identically, so ask for a fresh scan instead of showing
					// a button that loops.
					codeExpired = RECOVERABLE.test(message);
					// A station that has left its room stops accepting scans, and the
					// "try again" button would loop for as long as it stays there. Say
					// plainly that this is the screen's problem and the student has done
					// nothing wrong.
					stationMoved = /station has been moved out of its room/i.test(message);
					return;
				}
			}
		} catch (err) {
			// Reaching here means something outside an attempt failed — the client
			// itself. An expired token still has to go through sign-in rather than
			// being reported as a failed scan, or the student is stuck on a card
			// with no way forward.
			error = explainError(err) || 'That scan could not be recorded.';
			if (/sign in again|different phone|moved to another phone/i.test(error)) {
				endSession();
				if (code) stashPendingScan(sessionId, code);
				stage = 'signin';
				return;
			}
			stage = 'failed';
			codeExpired = RECOVERABLE.test(error);
		}
	}
</script>

	<StudentNav />
	<!--
		Same shape as `/scanner`: the page is the shared student width so the strip
		and heading line up across tabs, and the scan flow itself is a narrow
		centred column — it is read on a phone, one-handed, in a hall.
	-->
	<div class="mx-auto flex w-full max-w-md flex-col gap-4">
	<div class="text-center">
		<h1 class="text-2xl font-bold text-lams-navy">
			{#if preview}
				{preview.subjectCode} — {preview.subjectTitle}
			{:else}
				Attendance
			{/if}
		</h1>
		{#if preview}
			<p class="text-sm text-muted-foreground">{preview.className}</p>
		{/if}
	</div>

	{#if stage === 'checking'}
		<Card.Root aria-busy="true">
			<Card.Content class="flex flex-col items-center gap-3 pt-8 pb-8">
				<p class="text-sm text-muted-foreground">Checking your sign-in…</p>
			</Card.Content>
		</Card.Root>
	{:else if stage === 'signin'}
		<Card.Root>
			<Card.Content class="flex flex-col items-center gap-3 pt-6 text-center">
				<p class="text-sm font-medium">Sign in to record your attendance.</p>
				<p class="text-sm text-muted-foreground">
					Your scan is saved. Sign in and it will be recorded straight away.
				</p>
				<Button href="/signin" onclick={() => goto('/signin')}>Sign in</Button>
			</Card.Content>
		</Card.Root>
	{:else if stage === 'not_enrolled'}
		<!--
			The one refusal a student can fix themselves, so it gets a route out
			rather than a dead end. Worded as an instruction, because "not
			enrolled" is the system's vocabulary and not theirs.
		-->
		<Card.Root class="border-amber-300 bg-amber-50">
			<Card.Content class="flex flex-col items-center gap-3 pt-8 pb-8 text-center">
				<TriangleAlert class="size-10 text-amber-600" aria-hidden="true" />
				<p class="text-lg font-semibold text-amber-900">Add this subject first</p>
				<p class="text-sm text-amber-900">
					Nothing was recorded, because you are not taking
					<strong>{preview ? `${preview.subjectCode} — ${preview.subjectTitle}` : 'this subject'}</strong
					>. Add it to your subjects, then scan the screen again.
				</p>
				<div class="mt-1 flex flex-wrap justify-center gap-3">
					<Button href="/courses">Add this subject</Button>
					<Button variant="outline" href="/home">Not now</Button>
				</div>
				<p class="text-xs text-amber-900">
					If it should already be there, or you are repeating this subject with another class, ask your
					class rep or lecturer to add you.
				</p>
			</Card.Content>
		</Card.Root>
	{:else if stage === 'locating'}
		<Card.Root aria-busy="true">
			<Card.Content class="flex flex-col items-center gap-3 pt-8 pb-8 text-center">
				<MapPin class="size-8 animate-pulse text-lams-navy" aria-hidden="true" />
				<p class="text-sm font-medium">Checking you are at the station…</p>
				<p class="text-sm text-muted-foreground">
					Allow location access if your phone asks. That is what proves you are in the hall.
				</p>
			</Card.Content>
		</Card.Root>
	{:else if stage === 'done' && result}
		<Card.Root
			class={result.status === 'Present' || result.status === 'Late'
				? 'border-emerald-200 bg-emerald-50'
				: 'border-amber-300 bg-amber-50'}
		>
			<Card.Content class="flex flex-col items-center gap-2 pt-8 pb-8 text-center">
				{#if result.status === 'Present' || result.status === 'Late'}
					<CircleCheck class="size-12 text-emerald-600" aria-hidden="true" />
					<p class="text-lg font-semibold">You are marked {result.status}</p>
				{:else if result.status === 'Out_of_Range'}
					<CircleX class="size-12 text-red-600" aria-hidden="true" />
					<p class="text-lg font-semibold">You are marked Out of range</p>
				{:else}
					<CircleSlash class="size-12 text-amber-600" aria-hidden="true" />
					<p class="text-lg font-semibold">You are marked {result.status.replace('_', ' ')}</p>
				{/if}

				<p class="text-sm text-muted-foreground">
					{#if result.positionUsable}
						Your phone was {formatDistance(result.distanceM)} from the station when you scanned.
					{:else}
						Your location could not be checked, so your lecturer will confirm this record.
					{/if}
				</p>

				{#if result.status === 'Out_of_Range'}
					<p class="text-sm text-amber-900">
						Your phone reported being {formatDistance(result.distanceM)} away. If that is wrong, ask your
						class rep or lecturer — they can change it.
					</p>
				{:else if result.lateByMinutes}
					<p class="text-sm text-amber-900">
						You scanned {result.lateByMinutes} minute(s) after the late window closed. Your lecturer can
						change this if there is a reason.
					</p>
				{/if}

				<div class="mt-2 flex flex-wrap justify-center gap-3">
					<Button variant="outline" href="/attendance">See my attendance</Button>
					<Button href="/home">Done</Button>
				</div>

				<!--
					Said out loud rather than kept quiet: the code they scanned had already
					rolled when it reached the server, and the recovery did the work for
					them. Silent success would leave them believing a stale scan is fine,
					which is the habit the rotating code exists to break.
				-->
				{#if staleRecovered}
					<p class="text-xs text-muted-foreground">
						The code had already changed by the time your scan arrived, so the current one was used for you.
					</p>
				{/if}
			</Card.Content>
		</Card.Root>

		{#if !result.positionUsable && locationNote}
			<p class="text-center text-xs text-muted-foreground">
				Your phone said: “{locationNote}”. Turning location on and scanning again usually fixes it.
			</p>
		{/if}

		<Card.Root>
			<Card.Content class="flex flex-col gap-2 pt-6">
				<p class="text-sm font-medium">What your lecturer sees</p>
				<ul class="space-y-1 text-sm text-muted-foreground">
					<li class="flex gap-2">
						<CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
						<span>Your name, registration number and the exact time.</span>
					</li>
					<li class="flex gap-2">
						<MapPinCheck class="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
						<span>
							How far your own phone was from the station — measured by your phone, not anyone else's.
						</span>
					</li>
					<li class="flex gap-2">
						<CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
						<span>That the screen you scanned was live, not a photo of an old one.</span>
					</li>
				</ul>
				<p class="text-xs text-muted-foreground">
					If anything here looks wrong, tell your class rep or lecturer. They can correct it, and the
					correction is kept on the record.
				</p>
			</Card.Content>
		</Card.Root>
	{:else if stage === 'failed'}
		<Card.Root class={stationMoved ? 'border-red-300 bg-red-50' : ''}>
			<Card.Content class="flex flex-col items-center gap-3 pt-6 text-center">
				<TriangleAlert class="size-9 {stationMoved ? 'text-red-600' : 'text-amber-500'}" aria-hidden="true" />
				{#if stationMoved}
					<p class="text-base font-semibold text-red-900">The screen has been moved out of its room</p>
					<p class="text-sm text-red-900">
						Scanning is switched off while the screen is away from where it belongs, so nobody's attendance can
						be recorded in the wrong room. Tell your class rep. You have not lost anything — scan again once the
						screen is back.
					</p>
					<Button variant="outline" href="/attendance">See my attendance</Button>
				{:else}
					<p class="text-sm">{error}</p>
					{#if codeExpired}
						<p class="text-sm font-medium">Point your camera at the screen again.</p>
						<p class="text-xs text-muted-foreground">
							The code on the screen changes every 10 seconds. Scan it once more and this page will open
							again by itself.
						</p>
					{:else}
						<div class="flex flex-wrap justify-center gap-3">
							{#if preview && !closed}
								<Button onclick={() => submit()}>Try again</Button>
							{/if}
							<Button variant="outline" href="/attendance">See my attendance</Button>
						</div>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if preview && !closed && stage !== 'done'}
		<p class="text-center text-xs text-muted-foreground" aria-live="polite">
			{preview.subjectCode} closes in {Math.ceil(expiresIn / 1000)}s
		</p>
		{/if}
	</div>