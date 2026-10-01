<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { formatCountdown, getCurrentPosition } from '$lib/lams/geo';
	import { formatDateTime } from '$lib/lams/time';
	import { buildAttendanceUrl, qrDataUrl } from '$lib/lams/qr';
	import { printElement } from '$lib/lams/print';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import { Copy, Maximize, Printer, QrCode, RefreshCw, X } from '@lucide/svelte';
	import type { SessionDoc } from '$lib/lams/types';

	let {
		password,
		courseId,
		onSelect
	}: {
		password: string;
		courseId: string;
		onSelect: (sessionId: string) => void;
	} = $props();

	let sessions: SessionDoc[] = $state([]);
	let error = $state('');
	let note = $state('');
	let busy = $state(false);
	let lat = $state('');
	let lng = $state('');
	let radiusM = $state('50');
	let presentMin = $state('5');
	let totalMin = $state('5');

	let qrUrl = $state('');
	let qrImg = $state('');
	let qrLabel = $state('');
	let qrSessionId = $state('');
	let qrIsOpen = $state(true);
	let qrBusy = $state(false);
	let copied = $state(false);
	let fullscreen = $state(false);
	let qrPanel: HTMLDivElement | null = $state(null);
	let now = $state(Date.now());

	const openSessions = $derived(sessions.filter((s) => s.status === 'open'));
	const repUrl = $derived(
		qrSessionId
			? `${typeof window !== 'undefined' ? window.location.origin : ''}/a/${qrSessionId}/rep`
			: ''
	);

	onMount(() => {
		void load();
		const tick = setInterval(async () => {
			now = Date.now();
			// Spec §22.11: the cron retires lapsed sessions every minute; this makes the
			// UI flip to “closed” the moment the window lapses instead of waiting for it.
			const lapsed = sessions.find((s) => s.status === 'open' && now >= s.closesAt);
			if (lapsed) {
				try {
					const client = requireConvexClient();
					await client.mutation(api.sessions.expireIfDue, { sessionId: lapsed._id as never });
					await load();
				} catch {
					/* the cron will catch it shortly */
				}
			}
		}, 1000);
		const poll = setInterval(() => void load(), 15000);
		const onFsChange = () => (fullscreen = !!document.fullscreenElement);
		document.addEventListener('fullscreenchange', onFsChange);
		return () => {
			clearInterval(tick);
			clearInterval(poll);
			document.removeEventListener('fullscreenchange', onFsChange);
		};
	});

	async function load() {
		try {
			const client = requireConvexClient();
			sessions = (await client.query(api.sessions.listByCourse, {
				courseId: courseId as never
			})) as unknown as SessionDoc[];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load sessions.';
		}
	}

	async function useGps() {
		error = '';
		try {
			const pos = await getCurrentPosition();
			lat = String(pos.lat);
			lng = String(pos.lng);
			note = `Lecture GPS captured (±${Math.round(pos.accuracyM ?? 0)} m).`;
		} catch (err) {
			error = err instanceof Error ? err.message : 'GPS failed — type the coordinates instead.';
		}
	}

	/** Fetches the signed token for a session and renders its QR code. */
	async function showQr(sessionId: string, label: string) {
		qrBusy = true;
		error = '';
		try {
			const client = requireConvexClient();
			const full = (await client.query(api.sessions.getForLecturer, {
				password,
				sessionId: sessionId as never
			})) as SessionDoc | null;
			if (!full) throw new Error('Session not found.');
			qrUrl = buildAttendanceUrl(window.location.origin, sessionId, full.token);
			qrImg = await qrDataUrl(qrUrl);
			qrLabel = label;
			qrSessionId = sessionId;
			qrIsOpen = full.status === 'open';
			onSelect(sessionId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load the QR code.';
		} finally {
			qrBusy = false;
		}
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = '';
		note = '';
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.sessions.create, {
				password,
				courseId: courseId as never,
				lectureLat: Number(lat),
				lectureLng: Number(lng),
				radiusM: Number(radiusM),
				presentSec: Math.round(Number(presentMin) * 60),
				totalSec: Math.round(Number(totalMin) * 60)
			})) as { sessionId: string; token: string; closedOthers: number };
			qrUrl = buildAttendanceUrl(window.location.origin, res.sessionId, res.token);
			qrImg = await qrDataUrl(qrUrl);
			qrLabel = `Started ${formatDateTime(Date.now())}`;
			qrSessionId = res.sessionId;
			qrIsOpen = true;
			onSelect(res.sessionId);
			await load();
			note =
				res.closedOthers > 0
					? `New session live — ${res.closedOthers} older open session(s) retired, so only one QR is valid per course.`
					: 'New session live — show the QR code to the class.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Create failed.';
		} finally {
			busy = false;
		}
	}

	async function extend(id: string) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.sessions.extend, { password, sessionId: id as never, extraSec: 300 });
			await load();
			note = 'Session extended by 5 minutes.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Extend failed.';
		}
	}

	async function close(id: string) {
		if (!confirm('Close this session now? Every roster student without a record becomes Absent.')) return;
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.sessions.close, {
				password,
				sessionId: id as never
			})) as { absentAdded: number };
			await load();
			note = `Session closed — ${res.absentAdded} roster no-show(s) recorded as Absent.`;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Close failed.';
		}
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(qrUrl);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			error = 'Clipboard blocked — copy the link shown below manually.';
		}
	}

	async function toggleFullscreen() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await qrPanel?.requestFullscreen();
		} catch {
			error = 'Fullscreen is not available in this browser.';
		}
	}
</script>


<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<QrCode class="size-5 text-lams-navy" /> Step 4 — Sessions &amp; QR codes
		</Card.Title>
		<Card.Description>
			Spec §16 — every QR is valid for exactly 5 minutes by default (adjustable below). Starting a new
			session retires any open one, so only one QR is ever live per course. The QR dies when the window
			lapses — students arriving later are refused automatically.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		<form class="grid gap-2 md:grid-cols-3" onsubmit={create}>
			<div class="flex flex-col gap-1.5">
				<Label for="lecLat">Latitude</Label>
				<Input id="lecLat" bind:value={lat} placeholder="-13.9626" required />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="lecLng">Longitude</Label>
				<Input id="lecLng" bind:value={lng} placeholder="33.7741" required />
			</div>
			<div class="flex items-end gap-2">
				<Button variant="outline" type="button" onclick={useGps}>Use my GPS</Button>
				<a
					class="text-xs underline"
					href="https://www.openstreetmap.org"
					target="_blank"
					rel="noreferrer"
				>
					Verify on map
				</a>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="radiusM">Radius (m, default 50)</Label>
				<Input id="radiusM" bind:value={radiusM} placeholder="50" required />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="presentMin">Present window (min, default 5)</Label>
				<Input id="presentMin" bind:value={presentMin} placeholder="5" required />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="totalMin">Session length (min, default 5 — spec §16)</Label>
				<Input id="totalMin" bind:value={totalMin} placeholder="5" required />
			</div>
			<div class="md:col-span-3">
				<Button type="submit" disabled={busy}>
					{busy ? 'Creating…' : 'Create session + QR'}
				</Button>
				{#if openSessions.length > 0}
					<span class="ml-2 text-xs text-muted-foreground">
						A session is live — creating a new one retires it (one QR at a time).
					</span>
				{:else}
					<span class="ml-2 text-xs text-muted-foreground">
						In-range arrivals within the Present window are Present; later in-range arrivals are Late.
					</span>
				{/if}
			</div>
		</form>

		{#if error}
			<p class="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800" role="alert">{error}</p>
		{/if}
		{#if note}
			<p class="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900">{note}</p>
		{/if}

		{#if qrImg && qrUrl}
			<div
				bind:this={qrPanel}
				class="flex flex-col items-center gap-3 rounded-md border border-border p-4 {fullscreen
					? 'fixed inset-0 z-50 m-0 justify-center overflow-auto bg-white p-8'
					: ''}"
			>
				<div class="flex w-full flex-wrap items-center justify-between gap-2">
					<p class="flex flex-wrap items-center gap-2 text-sm font-medium">
						<QrCode class="mr-1 inline size-4" /> {qrLabel}
						{#if !qrIsOpen}
							<span class="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-700">
								Expired — display only, will not accept submissions
							</span>
						{/if}
					</p>
					<span class="flex gap-1">
						<Button variant="outline" size="sm" onclick={copyLink} aria-label="Copy attendance link">
							<Copy class="size-3.5" /> {copied ? 'Copied!' : 'Copy link'}
						</Button>
						<Button variant="outline" size="sm" onclick={toggleFullscreen}>
							<Maximize class="size-3.5" /> {fullscreen ? 'Exit' : 'Fullscreen'}
						</Button>
						<Button variant="outline" size="sm" onclick={() => printElement('#qr-print')}>
							<Printer class="size-3.5" /> Print
						</Button>
						<Button variant="ghost" size="sm" onclick={() => (qrImg = '')} aria-label="Close QR panel">
							<X class="size-3.5" />
						</Button>
					</span>
				</div>
				<img
					id="qr-print"
					src={qrImg}
					alt={qrIsOpen ? 'Attendance QR code' : 'Expired attendance QR code (display only)'}
					class="rounded-md bg-white {fullscreen ? 'max-h-[70vh] w-auto' : 'size-64'} {!qrIsOpen
						? 'opacity-40 grayscale'
						: ''}"
				/>
				<p class="break-all text-center text-xs text-muted-foreground">{qrUrl}</p>
				{#if qrIsOpen}
					<div class="flex flex-wrap items-center justify-center gap-3 text-xs">
						<a href={qrUrl} target="_blank" rel="noreferrer" class="underline">Open student form</a>
						{#if qrSessionId}
							<a href={repUrl} target="_blank" rel="noreferrer" class="underline">
								Open class-rep batch entry
							</a>
						{/if}
					</div>
				{:else}
					<p class="text-center text-xs text-muted-foreground">
						This session is closed — the code above is kept for records only.
					</p>
				{/if}
			</div>
		{/if}

		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between gap-2">
				<p class="text-sm font-medium">Sessions for this course ({sessions.length})</p>
				<Button variant="outline" size="sm" onclick={load} aria-label="Refresh sessions">
					<RefreshCw class="size-3.5" /> Refresh
				</Button>
			</div>
			{#if sessions.length === 0}
				<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
					No sessions yet for this course. Create the first one above.
				</p>
			{:else}
				{#each sessions as s (s._id)}
					<div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
						<span class="flex flex-wrap items-center gap-2">
							<StatusBadge status={s.status} />
							<span class="text-muted-foreground">
								{formatDateTime(s.startedAt)} · {s.radiusM} m ·
								{Math.round(s.presentSec / 60)}/{Math.round(s.totalSec / 60)} min
								{#if s.status === 'open'}
									·
									{#if now >= s.closesAt}
										window lapsed — closing now
									{:else}
										<span aria-live="polite">closes in <strong>{formatCountdown(s.closesAt - now)}</strong></span>
									{/if}
								{:else if s.closedAt}
									· closed {formatDateTime(s.closedAt)}
								{/if}
							</span>
						</span>
						<span class="flex flex-wrap gap-1">
							<Button variant="outline" size="sm" onclick={() => onSelect(s._id)}>Attendance</Button>
							{#if s.status === 'open'}
								<Button
									variant="secondary"
									size="sm"
									disabled={qrBusy}
									onclick={() => showQr(s._id, `Started ${formatDateTime(s.startedAt)}`)}
								>
									Show QR
								</Button>
								<Button variant="secondary" size="sm" onclick={() => extend(s._id)}>+5 min</Button>
								<Button variant="destructive" size="sm" onclick={() => close(s._id)}>Close</Button>
							{:else}
								<Button
									variant="outline"
									size="sm"
									disabled={qrBusy}
									onclick={() => showQr(s._id, `Expired ${formatDateTime(s.closesAt)}`)}
								>
									View QR
								</Button>
							{/if}
						</span>
					</div>
				{/each}
			{/if}
		</div>
	</Card.Content>
</Card.Root>

