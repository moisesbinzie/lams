<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import { buildScanCode, secondsRemaining } from '$lib/lams/totp';
	import { getCurrentPosition } from '$lib/lams/geo';
	import { qrDataUrl } from '$lib/lams/qr';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { CircleCheck, Maximize, MapPinCheck, TriangleAlert } from '@lucide/svelte';

	let secret = $state('');
	let regNumber = $state('');
	let qrImg = $state('');
	let loading = $state(true);
	let error = $state('');
	let now = $state(Date.now());
	let fullscreen = $state(false);
	let panel: HTMLDivElement | null = $state(null);
	// Set once the rep has scanned us and we have confirmed our own location.
	let scannedAt = $state(0);
	let locationSent = $state(false);

	/**
	 * The code rolls every 30 seconds. Showing it as text as well as a QR means
	 * a student whose camera will not focus can read it out, and it gives the
	 * rep screen something to compare by eye.
	 */
	const code = $derived(secret ? buildScanCode(regNumber, secret, now).split('|')[2] : '');
	const remaining = $derived(secondsRemaining(now));
	const progress = $derived((remaining / 30) * 100);

	async function regenerate() {
		if (!secret) return;
		qrImg = await qrDataUrl(buildScanCode(regNumber, secret, now), 512);
	}

	onMount(() => {
		let alive = true;
		const token = getToken();
		if (!token) {
			void goto('/signin');
			return;
		}

		void (async () => {
			try {
				const client = requireConvexClient();
				const res = await client.query(api.attendance.myScanCode, { token });
				if (!alive) return;
				if (!res) {
					// Token no longer accepted — end the session everywhere.
					endSession();
					void goto('/signin');
					return;
				}
				secret = res.qrSecret;
				regNumber = res.regNumber;
				now = Date.now();
				await regenerate();
			} catch (err) {
				if (alive) error = err instanceof Error ? err.message : 'Could not load your code.';
			} finally {
				if (alive) loading = false;
			}
		})();

		const tick = setInterval(async () => {
			const before = code;
			now = Date.now();
			if (code !== before) await regenerate();
		}, 1000);
		const scanPoll = setInterval(() => void checkForScan(), 4000);
		const onFs = () => (fullscreen = !!document.fullscreenElement);
		document.addEventListener('fullscreenchange', onFs);
		return () => {
			alive = false;
			clearInterval(tick);
			clearInterval(scanPoll);
			document.removeEventListener('fullscreenchange', onFs);
		};
	});

	async function toggleFullscreen() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await panel?.requestFullscreen();
		} catch {
			error = 'Full screen is not available in this browser.';
		}
	}

	/**
	 * A student must already have this page open to show their code, so this poll
	 * costs nothing in practice. It reports *our* location the moment we are
	 * scanned, which is the only way the system can check the student rather
	 * than just the class rep — see SECURITY.md.
	 */
	async function checkForScan() {
		try {
			const client = requireConvexClient();
			const latest = await client.query(api.attendance.myLatestScan, { token: getToken() });
			if (!latest || locationSent) return;
			scannedAt = latest.at;
			locationSent = true;
			try {
				const pos = await getCurrentPosition();
				await client.mutation(api.attendance.confirmMyLocation, {
					token: getToken(),
					latitude: pos.lat,
					longitude: pos.lng,
					...(pos.accuracyM !== undefined ? { accuracyM: pos.accuracyM } : {})
				});
			} catch {
				// Location denied — the attendance record already stands; it is
				// simply not location-confirmed, which the lecturer can see.
			}
		} catch {
			// Never let this poll interrupt the code display.
		}
	}
</script>

<div class="mx-auto flex max-w-md flex-col gap-4">
	<div class="text-center">
		<h1 class="text-2xl font-bold text-lams-navy">My attendance code</h1>
		<p class="text-sm text-muted-foreground">
			Show this to your class rep or lecturer. It changes every 30 seconds, so a photo of it stops working.
		</p>
	</div>

	{#if loading}
		<Card.Root aria-busy="true">
			<Card.Content class="flex flex-col gap-3 pt-6">
				<div class="mx-auto size-72 animate-pulse rounded-lg bg-muted"></div>
				<p class="text-center text-sm text-muted-foreground">Preparing your code…</p>
			</Card.Content>
		</Card.Root>
	{:else if error && !secret}
		<Card.Root>
			<Card.Content class="flex flex-col items-center gap-3 pt-6 text-center">
				<TriangleAlert class="size-9 text-amber-500" aria-hidden="true" />
				<p class="text-sm">{error}</p>
				<Button href="/home">Back to my account</Button>
			</Card.Content>
		</Card.Root>
	{:else if qrImg}
		<div
			bind:this={panel}
			class="flex flex-col items-center gap-4 rounded-lg border border-border p-5 {fullscreen
				? 'fixed inset-0 z-50 m-0 justify-center overflow-auto bg-white p-8'
				: ''}"
		>
			<img
				src={qrImg}
				alt="Your personal attendance code"
				class="rounded-lg bg-white {fullscreen ? 'max-h-[60vh] w-auto' : 'size-72'}"
			/>
			<p class="text-center">
				<span class="block text-4xl font-bold tracking-[0.3em] text-lams-navy">{code}</span>
				<span class="text-xs text-muted-foreground">Your reg number: {regNumber}</span>
			</p>
			<div class="w-full max-w-xs">
				<div
					class="h-1.5 w-full overflow-hidden rounded-full bg-muted"
					role="progressbar"
					aria-label="Time until this code refreshes"
					aria-valuemin="0"
					aria-valuemax="30"
					aria-valuenow={remaining}
				>
					<div
						class="h-full rounded-full bg-lams-green transition-[width] duration-1000"
						style={`width: ${progress}%`}
					></div>
				</div>
				<p class="mt-1 text-center text-xs text-muted-foreground" aria-live="polite">
					Refreshes in {remaining}s
				</p>
			</div>
			<Button variant="outline" size="sm" onclick={toggleFullscreen}>
				<Maximize class="size-3.5" /> {fullscreen ? 'Exit full screen' : 'Full screen'}
			</Button>
		</div>

		{#if scannedAt > 0}
			<Card.Root class="border-emerald-200 bg-emerald-50">
				<Card.Content class="flex items-center gap-3 pt-6">
					<CircleCheck class="size-8 shrink-0 text-emerald-600" aria-hidden="true" />
					<div>
						<p class="text-sm font-medium">You have been recorded present.</p>
						<p class="text-xs text-muted-foreground">
							{locationSent
								? 'Your own location was checked against the lecture hall and sent to your lecturer.'
								: 'Your location could not be checked, so your lecturer will see the record as unconfirmed.'}
						</p>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Content class="flex flex-col gap-2 pt-6">
				<p class="text-sm font-medium">What your lecturer sees</p>
				<ul class="space-y-1 text-sm text-muted-foreground">
					<li class="flex gap-2">
						<CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
						<span>Your name and registration number.</span>
					</li>
					<li class="flex gap-2">
						<CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
						<span>The exact time your code was scanned.</span>
					</li>
					<li class="flex gap-2">
						<MapPinCheck class="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
						<span>Whether you were inside the lecture hall — checked from your own phone, not just theirs.</span>
					</li>
					<li class="flex gap-2">
						<CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
						<span>That your own code was used — nobody can mark you present without it.</span>
					</li>
				</ul>
				<p class="text-xs text-muted-foreground">
					You can check your record any time and report anything that looks wrong.
				</p>
				<Button variant="outline" href="/attendance">See my attendance</Button>
			</Card.Content>
		</Card.Root>
	{/if}
</div>