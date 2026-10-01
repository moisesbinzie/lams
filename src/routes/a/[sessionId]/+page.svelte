<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { formatCountdown, formatDistance, getCurrentPosition } from '$lib/lams/geo';
	import { elapsedPct, formatTime } from '$lib/lams/time';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import { CircleCheck, TriangleAlert } from '@lucide/svelte';
	import type { PublicSession } from '$lib/lams/types';

	const ME_KEY = 'lams_me';
	const sessionId = page.params.sessionId as string;
	const token = page.url.searchParams.get('t') ?? '';

	let session: PublicSession | null = $state(null);
	let loadError = $state('');
	let loading = $state(true);
	let submitting = $state(false);
	let locating = $state(false);
	let lookingUp = $state(false);
	let rosterMatched = $state(false);
	let remembered = $state(false);
	let error = $state('');
	let alreadySubmitted = $state(false);
	let result: { status: string; distanceM: number | null; accuracyM: number | null; at: number } | null =
		$state(null);

	let fullName = $state('');
	let regNumber = $state('');
	let studentId = $state('');
	let now = $state(Date.now());
	let timer: ReturnType<typeof setInterval> | null = null;
	let lookupTimer: ReturnType<typeof setTimeout> | null = null;
	let expiryRequested = false;

	// An open session whose window has lapsed is treated as closed immediately —
	// the backend cron flips the stored status within the minute. ($derived.by so
	// `session` keeps its declared type instead of narrowing to its initializer.)
	const closed = $derived.by(() => {
		const s = session;
		return s ? s.status === 'closed' || now >= s.closesAt : false;
	});
	const progress = $derived.by(() => {
		const s = session;
		return s ? elapsedPct(s.startedAt, s.closesAt, now) : 0;
	});

	function loadRemembered() {
		try {
			const raw = localStorage.getItem(ME_KEY);
			if (!raw) return;
			const me = JSON.parse(raw) as { fullName?: string; regNumber?: string; studentId?: string };
			if (me.regNumber) {
				regNumber = me.regNumber;
				if (me.fullName) fullName = me.fullName;
				if (me.studentId) studentId = me.studentId;
				remembered = true;
				void lookupRoster();
			}
		} catch {
			// Corrupt entry — ignore.
		}
	}

	function forgetMe() {
		try {
			localStorage.removeItem(ME_KEY);
		} catch {
			// Storage unavailable — ignore.
		}
		fullName = '';
		regNumber = '';
		studentId = '';
		rosterMatched = false;
		remembered = false;
	}

	async function lookupRoster() {
		const reg = regNumber.trim();
		if (!reg || !session) {
			rosterMatched = false;
			return;
		}
		lookingUp = true;
		try {
			const client = requireConvexClient();
			const match = await client.query(api.students.findByReg, { sessionId: sessionId as never, regNumber: reg });
			if (match) {
				fullName = match.fullName;
				studentId = match.studentId;
				rosterMatched = true;
			} else {
				rosterMatched = false;
			}
		} catch {
			rosterMatched = false;
		} finally {
			lookingUp = false;
		}
	}

	function onRegInput() {
		rosterMatched = false;
		alreadySubmitted = false;
		if (lookupTimer) clearTimeout(lookupTimer);
		lookupTimer = setTimeout(() => void lookupRoster(), 500);
	}

	async function refreshSession() {
		try {
			const client = requireConvexClient();
			const s = await client.query(api.sessions.getPublic, { sessionId: sessionId as never });
			if (s) session = s as unknown as PublicSession;
		} catch {
			// Keep the last known state; the countdown still drives the UI.
		}
	}

	async function closeIfDue() {
		try {
			const client = requireConvexClient();
			await client.mutation(api.sessions.expireIfDue, { sessionId: sessionId as never });
			await refreshSession();
		} catch {
			// The server-side cron retires the session shortly.
		}
	}

	onMount(() => {
		(async () => {
			try {
				const client = requireConvexClient();
				const s = await client.query(api.sessions.getPublic, { sessionId: sessionId as never });
				if (!s) {
					loadError = 'Session not found. Check the QR code with your lecturer.';
				} else {
					session = s as unknown as PublicSession;
					now = Date.now();
					loadRemembered();
				}
			} catch (e) {
				loadError = e instanceof Error ? e.message : 'Failed to load session.';
			} finally {
				loading = false;
			}
		})();
		timer = setInterval(() => {
			now = Date.now();
			const due = session ? session.status === 'open' && now >= session.closesAt : false;
			if (due && !expiryRequested) {
				expiryRequested = true;
				void closeIfDue();
			}
		}, 1000);
		return () => {
			if (timer) clearInterval(timer);
			if (lookupTimer) clearTimeout(lookupTimer);
		};
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		alreadySubmitted = false;
		if (!session) return;
		if (closed) {
			error = 'This session has closed — new submissions are no longer accepted.';
			return;
		}
		if (!token) {
			error = 'Missing QR token. Please re-scan the QR code.';
			return;
		}
		if (!regNumber.trim()) {
			error = 'Registration number required.';
			return;
		}
		submitting = true;
		try {
			let lat: number | undefined;
			let lng: number | undefined;
			let accuracy: number | undefined;
			locating = true;
			try {
				const pos = await getCurrentPosition();
				lat = pos.lat;
				lng = pos.lng;
				accuracy = pos.accuracyM;
			} catch (geoErr) {
				// Submit without GPS; the server records time-only verification.
				console.warn('GPS unavailable:', geoErr);
			} finally {
				locating = false;
			}
			const client = requireConvexClient();
			const res = await client.mutation(api.attendance.submitSelf, {
				sessionId: sessionId as never,
				token,
				fullName,
				regNumber,
				studentId,
				// Omit GPS keys when denied — Convex rejects `undefined` values.
				...(lat !== undefined && lng !== undefined ? { studentLat: lat, studentLng: lng } : {}),
				...(accuracy !== undefined ? { accuracyM: accuracy } : {})
			});
			result = {
				status: res.status,
				distanceM: res.distanceM ?? null,
				accuracyM: accuracy ?? null,
				at: Date.now()
			};
			try {
				localStorage.setItem(ME_KEY, JSON.stringify({ fullName, regNumber, studentId }));
				remembered = true;
			} catch {
				// Storage unavailable — attendance still recorded.
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Submission failed.';
			alreadySubmitted = /already recorded/i.test(message);
			error = message;
			// A rejected late submission means the window lapsed meanwhile.
			if (/closed|expired/i.test(message)) await refreshSession();
		} finally {
			submitting = false;
		}
	}

</script>

<div class="mx-auto flex max-w-xl flex-col gap-4">
	<div class="flex items-center gap-3">
		<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
		<div>
			<h1 class="text-xl font-bold text-lams-navy">Lecture attendance</h1>
			<p class="text-xs text-muted-foreground">
				{#if session}
					{session.courseCode}{session.courseTitle ? ` · ${session.courseTitle}` : ''}
				{:else}
					Scan → confirm → go.
				{/if}
			</p>
		</div>
	</div>

	{#if loading}
		<Card.Root aria-busy="true">
			<Card.Content class="flex flex-col gap-3 pt-6">
				<div class="h-5 w-2/3 animate-pulse rounded-md bg-muted" aria-hidden="true"></div>
				<div class="h-4 w-full animate-pulse rounded-md bg-muted" aria-hidden="true"></div>
				<div class="h-10 w-full animate-pulse rounded-md bg-muted" aria-hidden="true"></div>
				<p class="text-sm text-muted-foreground">Loading session…</p>
			</Card.Content>
		</Card.Root>
	{:else if loadError}
		<Card.Root>
			<Card.Content class="pt-6 text-sm text-red-700">{loadError}</Card.Content>
		</Card.Root>
	{:else if session}
		<Card.Root>
			<Card.Header class="gap-3">
				<Card.Title class="flex flex-wrap items-center gap-2 text-base">
					<StatusBadge status={session.status} />
					{#if closed}
						<span class="text-sm font-normal text-muted-foreground" aria-live="polite">
							Closed at {formatTime(session.closesAt)} — arrivals after this cannot be accepted.
						</span>
					{:else}
						<span class="text-sm font-normal text-muted-foreground" aria-live="polite">
							Closes in {formatCountdown(session.closesAt - now)} — the QR dies automatically.
						</span>
					{/if}
				</Card.Title>
				<div
					class="h-1.5 w-full overflow-hidden rounded-full bg-muted"
					role="progressbar"
					aria-label="Session time used"
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={Math.round(progress)}
				>
					<div
						class="h-full rounded-full transition-[width] duration-1000 {closed
							? 'bg-neutral-400'
							: 'bg-lams-green'}"
						style={`width: ${progress}%`}
					></div>
				</div>
			</Card.Header>
			<Card.Content>
				{#if result}
					<div class="flex flex-col items-center gap-3 py-2 text-center">
						<CircleCheck class="size-11 text-emerald-600" aria-hidden="true" />
						<StatusBadge status={result.status} size="lg" />
						<p class="text-sm">
							Thank you, <span class="font-medium">{fullName || regNumber}</span>. Your attendance was
							recorded at {formatTime(result.at)}.
						</p>
						<dl class="grid w-full grid-cols-2 gap-2 text-left text-sm">
							<div class="rounded-md border border-border p-2">
								<dt class="text-xs text-muted-foreground">Distance from lecture</dt>
								<dd class="font-medium">{formatDistance(result.distanceM)}</dd>
							</div>
							<div class="rounded-md border border-border p-2">
								<dt class="text-xs text-muted-foreground">GPS accuracy</dt>
								<dd class="font-medium">
									{result.accuracyM === null ? 'Not available' : `±${Math.round(result.accuracyM)} m`}
								</dd>
							</div>
						</dl>
						{#if result.status === 'Out_of_Range'}
							<p class="w-full rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-900">
								You were outside the permitted radius. Your record is stored and flagged so the
								lecturer can review it.
							</p>
						{:else if result.status === 'Late'}
							<p class="w-full rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
								You arrived after the Present window, so you were marked Late. The lecturer can override
								this if needed.
							</p>
						{/if}
						{#if result.distanceM === null}
							<p class="w-full rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" role="note">
								No GPS fix was available — your entry is recorded but flagged as
								location-unverified for the lecturer to review.
							</p>
						{/if}
						<p class="text-xs text-muted-foreground">
							Returning later? This phone remembers your details automatically.
						</p>
					</div>
				{:else if closed}
					<div class="flex flex-col items-center gap-2 py-4 text-center">
						<StatusBadge status="closed" size="lg" />
						<p class="text-sm font-medium">This attendance session has closed.</p>
						<p class="text-sm text-muted-foreground">
							The QR code is no longer valid and new submissions are refused. If you are still in the
							lecture, ask the lecturer to extend or start a new session.
						</p>
					</div>
				{:else}
					<form class="flex flex-col gap-4" onsubmit={submit}>
						<div class="flex flex-col gap-1.5">
							<Label for="regNumber">Registration number</Label>
							<Input
								id="regNumber"
								bind:value={regNumber}
								oninput={onRegInput}
								placeholder="e.g. BIT/2024/0123"
								autocomplete="off"
								required
							/>
							{#if lookingUp}
								<p class="text-xs text-muted-foreground">Checking roster…</p>
							{:else if rosterMatched}
								<p class="text-xs font-medium text-emerald-700">
									Found on the roster — name and student ID filled in. Just submit.
								</p>
							{:else if remembered}
								<p class="text-xs text-muted-foreground">
									Remembered from this phone.
									<button type="button" class="underline" onclick={forgetMe}>Not you?</button>
								</p>
							{:else}
								<p class="text-xs text-muted-foreground">
									Not on the roster yet? Type all three fields once.
								</p>
							{/if}
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="fullName">Full name {rosterMatched ? '(from roster)' : ''}</Label>
							<Input
								id="fullName"
								bind:value={fullName}
								placeholder="e.g. Amina Yusuf Banda"
								required={!rosterMatched}
								disabled={rosterMatched}
							/>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="studentId">Student ID {rosterMatched ? '(from roster)' : ''}</Label>
							<Input
								id="studentId"
								bind:value={studentId}
								placeholder="e.g. 2024-0123"
								required={!rosterMatched}
								disabled={rosterMatched}
							/>
						</div>
						{#if error}
							<p
								class="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
								role="alert"
							>
								<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
								<span>
									{error}
									{#if alreadySubmitted}
										Your registration number already has a record for this session — see the lecturer if
										it looks wrong.
									{/if}
								</span>
							</p>
						{/if}
						<Button type="submit" size="lg" disabled={submitting}>
							{submitting ? (locating ? 'Capturing location…' : 'Submitting…') : 'Submit attendance'}
						</Button>
						<p class="text-xs text-muted-foreground">
							Your GPS location and submission time are recorded automatically for verification — you
							never type them. If location is denied, your entry is still sent and flagged.
						</p>
					</form>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
