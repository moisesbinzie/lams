<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import { formatCountdown, getCurrentPosition } from '$lib/lams/geo';
	import { buildStationUrl, currentStationCode, secondsRemaining } from '$lib/lams/station';
	import { qrDataUrl } from '$lib/lams/qr';
	import StartSessionForm from '$lib/components/lams/start-session-form.svelte';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Maximize,
		Pencil,
		TriangleAlert,
		Users
	} from '@lucide/svelte';
	import type { AttendanceRecord, LectureSession, StationFeed } from '$lib/lams/types';

	let token = $state('');
	let sessions = $state<LectureSession[]>([]);
	let live = $state<StationFeed | null>(null);
	let records = $state<AttendanceRecord[]>([]);
	let error = $state('');
	let notice = $state('');
	let busy = $state(false);
	let now = $state(Date.now());
	let origin = $state('');

	// Hand-add / override panel
	let manualReg = $state('');
	let manualStatus = $state<'Present' | 'Late' | 'Excused'>('Present');
	let manualReason = $state('');
	let roster = $state<{ regNumber: string; label: string }[]>([]);
	let editingId = $state<string | null>(null);
	let editStatus = $state<'Present' | 'Late' | 'Excused'>('Present');

	// Station display
	let qrImg = $state('');
	let fullscreen = $state(false);
	let panel: HTMLDivElement | null = $state(null);

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
			'Present in person, rep confirmed',
			'Scanner read the wrong student'
		];

		const flagged = $derived(records.filter((r) => r.flagged));
	const closed = $derived(live ? live.status === 'closed' || now >= live.closesAt : true);
	const remaining = $derived(secondsRemaining(now));

	/**
	 * The code rolling every 30 seconds is the whole anti-sharing mechanism, so
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
		const onFs = () => (fullscreen = !!document.fullscreenElement);
		document.addEventListener('fullscreenchange', onFs);
		return () => {
			clearInterval(tick);
			clearInterval(poll);
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
			error = err instanceof Error ? err.message : 'Could not load your lectures.';
		}
	}

	async function openSession(id: string) {
		error = '';
		notice = '';
		try {
			const client = requireConvexClient();
			const feed = await client.query(api.attendance.stationFeed, {
				token,
				sessionId: id as never
			});
			live = feed as unknown as StationFeed | null;
			if (live) {
				now = Date.now();
				await Promise.all([loadRecords(), loadRoster()]);
			}
		} catch (err) {
			live = null;
			error = err instanceof Error ? err.message : 'Could not open that lecture.';
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
		error = '';
		try {
			const client = requireConvexClient();
			const res = await client.mutation(api.attendance.extendSession, {
				token,
				sessionId: live._id as never,
				extraSec: extraMin * 60
			});
			live = { ...live, closesAt: res.closesAt, status: 'open' };
			notice = `Window extended by ${extraMin} minute(s).`;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not extend the window.';
		}
	}

	async function toggleFullscreen() {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await panel?.requestFullscreen();
		} catch {
			error = 'Full screen is not available in this browser.';
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
			error = 'Say why this student was added by hand — it is kept on the record.';
			return;
		}
		busy = true;
		error = '';
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
			notice = 'Student added by hand.';
			await loadRecords();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not add that student.';
		} finally {
			busy = false;
		}
	}

	async function saveOverride() {
		if (!editingId) return;
		if (!manualReason.trim()) {
			error = 'Say why this record is being changed — it is kept on the record.';
			return;
		}
		busy = true;
		error = '';
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
			notice = 'Record updated.';
			await loadRecords();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not change that record.';
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
			notice = `Lecture closed. ${res.absentAdded} student(s) marked absent.`;
			await loadSessions();
			await loadRecords();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not close the lecture.';
		}
	}
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-4">
	<div class="text-center">
		<h1 class="text-2xl font-bold text-lams-navy">Take attendance</h1>
		<p class="text-sm text-muted-foreground">
			Put this screen at the front of the hall. Students scan it with their own phones.
		</p>
	</div>

	{#if error}
		<p
			class="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
			role="alert"
		>
			<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<span>{error}</span>
		</p>
	{/if}
	{#if notice}
		<p class="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" role="status">{notice}</p>
	{/if}

	{#if !live}
		<Card.Root>
			<Card.Header>
				<Card.Title>Open lectures</Card.Title>
				<Card.Description>Only lectures for your classes are listed.</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if sessions.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						No lectures running yet. Start one below, or wait for one to open.
					</p>
				{:else}
					<ul class="flex flex-col gap-2">
						{#each sessions as s (s._id)}
							<li class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
								<span class="text-sm">
									<strong>{s.subjectCode}</strong> — {s.subjectTitle}
									<span class="block text-xs text-muted-foreground">
										{s.className} · {new Date(s.startedAt).toLocaleString()}
									</span>
								</span>
								<span class="flex items-center gap-2">
									<StatusBadge status={s.status} />
									<Button size="sm" onclick={() => openSession(s._id)}>Open</Button>
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>

		<StartSessionForm onstarted={(id) => openSession(id)} />
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
					class="rounded-lg bg-white {fullscreen ? 'max-h-[55vh] w-auto' : 'size-72'}"
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
						aria-valuemax="30"
						aria-valuenow={remaining}
					>
						<div
							class="h-full rounded-full bg-lams-green transition-[width] duration-1000"
							style={`width: ${(remaining / 30) * 100}%`}
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
								<select
									id="estatus"
									class="w-full rounded-md border border-input bg-background p-2 text-sm"
									bind:value={editStatus}
								>
									<option value="Present">Present</option>
									<option value="Late">Late</option>
									<option value="Excused">Excused</option>
									<option value="Absent">Absent</option>
								</select>
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
							<select
								id="mstatus"
								class="w-full rounded-md border border-input bg-background p-2 text-sm"
								bind:value={manualStatus}
							>
								<option value="Present">Present</option>
								<option value="Late">Late</option>
								<option value="Excused">Excused</option>
							</select>
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