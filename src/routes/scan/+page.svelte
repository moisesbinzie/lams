<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import { formatCountdown, getCurrentPosition } from '$lib/lams/geo';
	import { parseScanCode } from '$lib/lams/totp';
	import QrScanner from '$lib/components/lams/qr-scanner.svelte';
	import StartSessionForm from '$lib/components/lams/start-session-form.svelte';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { CircleCheck, TriangleAlert, Undo2, X } from '@lucide/svelte';
	import type { AttendanceRecord, LectureSession, ScanSession } from '$lib/lams/types';

		interface FlaggedRecord extends AttendanceRecord {
			flagged?: boolean;
			flagReason?: string | null;
			verification?: string;
			studentDistanceM?: number | null;
		}

	let token = $state('');
	let sessions = $state<LectureSession[]>([]);
	let live = $state<ScanSession | null>(null);
	let records = $state<FlaggedRecord[]>([]);
	let error = $state('');
	let busy = $state(false);
	let manualReg = $state('');
	let manualStatus = $state<'Present' | 'Late' | 'Excused'>('Present');
	let now = $state(Date.now());
	let poll: ReturnType<typeof setInterval> | null = null;

	type Result = { name: string; status: string };
	let results = $state<Result[]>([]);
	let lastResult = $state<Result | null>(null);
	let notice = $state('');
	// Roster suggestions for adding someone without a working code.
	let roster = $state<{ regNumber: string; label: string }[]>([]);

	const flagged = $derived(records.filter((r) => r.flagged));

		const closed = $derived(live ? live.status === 'closed' || now >= live.closesAt : true);

	onMount(() => {
		token = getToken();
		if (!token) {
			void goto('/signin');
			return;
		}
		void loadSessions();
		const tick = setInterval(() => (now = Date.now()), 1000);
		poll = setInterval(() => {
			if (live && live.status === 'open') void loadRecords();
		}, 5000);
		return () => {
			clearInterval(tick);
			if (poll) clearInterval(poll);
		};
	});

	async function loadSessions() {
		try {
			const client = requireConvexClient();
			sessions = (await client.query(api.attendance.listForRecordKeeper, {
				token
			})) as unknown as LectureSession[];
		} catch (err) {
			// Keep the token: a failed load is usually a network blip.
			error = err instanceof Error ? err.message : 'Could not load your lectures.';
		}
	}

	async function openSession(id: string) {
		error = '';
		results = [];
		lastResult = null;
		try {
			const client = requireConvexClient();
			const s = await client.query(api.attendance.getSession, { token, sessionId: id as never });
			live = s as unknown as ScanSession | null;
			if (live) {
				now = Date.now();
				await loadRecords();
				void loadRoster();
			}
		} catch (err) {
			live = null;
			error = err instanceof Error ? err.message : 'Could not open that lecture.';
		}
	}

	/** Enrolled students, offered as suggestions when adding someone by hand. */
	async function loadRoster() {
		if (!live) return;
		try {
			const client = requireConvexClient();
			const rows = (await client.query(api.enrolments.listForOffering, {
				token,
				offeringId: live.offeringId as never
			})) as unknown as { fullName: string; regNumber: string }[];
			roster = rows
				.filter((r) => r.regNumber)
				.map((r) => ({ regNumber: r.regNumber, label: `${r.fullName} (${r.regNumber})` }));
		} catch {
			// Suggestions are optional; the plain reg-number input still works.
			roster = [];
		}
	}

	async function extend(extraMin: number) {
		if (!live) return;
		error = '';
		try {
			const client = requireConvexClient();
			const res = (await client.mutation(api.attendance.extendSession, {
				token,
				sessionId: live._id as never,
				extraSec: extraMin * 60
			})) as { closesAt: number };
			live = { ...live, closesAt: res.closesAt, status: 'open' };
			notice = `Window extended by ${extraMin} minute(s).`;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not extend the window.';
		}
	}

	async function loadRecords() {
		if (!live) return;
		try {
			const client = requireConvexClient();
			records = (await client.query(api.attendance.listBySession, {
				token,
				sessionId: live._id as never
			})) as unknown as FlaggedRecord[];
		} catch {
			// Keep the last known list rather than blanking the screen mid-lecture.
		}
	}

	async function onScan(text: string) {
		if (!parseScanCode(text)) {
			error = 'That is not a student attendance code.';
			return;
		}
		await recordScan(text);
	}

	async function recordScan(text: string) {
		if (!live) {
			error = 'Open a lecture first.';
			return;
		}
		if (closed) {
			error = 'This lecture is closed. No more students can be recorded.';
			return;
		}
		busy = true;
		error = '';
		try {
			const client = requireConvexClient();
			let lat: number | undefined;
			let lng: number | undefined;
			let accuracy: number | undefined;
			try {
				const pos = await getCurrentPosition();
				lat = pos.lat;
				lng = pos.lng;
				accuracy = pos.accuracyM;
			} catch {
				// Recorded anyway; the lecturer sees it as location-unconfirmed.
			}
			const res = (await client.mutation(api.attendance.recordScan, {
				token,
				sessionId: live._id as never,
				qr: text,
				...(lat !== undefined ? { latitude: lat } : {}),
				...(lng !== undefined ? { longitude: lng } : {}),
				...(accuracy !== undefined ? { accuracyM: accuracy } : {})
			})) as { fullName: string; status: string; lateByMinutes?: number };
			results = [{ name: res.fullName, status: res.status }, ...results].slice(0, 30);
			lastResult = results[0];
			if (res.status === 'Absent') {
				notice = `${res.fullName} arrived ${res.lateByMinutes} minute(s) after the late window, so they were recorded as absent.`;
			}
			await loadRecords();
		} catch (err) {
			error = err instanceof Error ? err.message : 'That scan could not be recorded.';
		} finally {
			busy = false;
		}
	}

	async function addManually(e: SubmitEvent) {
		e.preventDefault();
		if (!live) return;
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
				// Fine — the record is tagged location-unconfirmed.
			}
			await client.mutation(api.attendance.addManually, {
				token,
				sessionId: live._id as never,
				regNumber: manualReg.trim(),
				status: manualStatus,
				...(lat !== undefined ? { latitude: lat } : {}),
				...(lng !== undefined ? { longitude: lng } : {})
			});
			manualReg = '';
			notice = 'Student added.';
			await loadRecords();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not add that student.';
		} finally {
			busy = false;
		}
	}

	/** Removes a scan made moments ago, so a wrong-phone mix-up is fixable now. */
	async function undo(id: string) {
		error = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.attendance.undoOwnScan, { token, attendanceId: id as never });
			await loadRecords();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not undo that.';
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
			await loadSessions();
			await openSession(live._id);
			notice = `Lecture closed. ${res.absentAdded} student(s) marked absent.`;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not close the lecture.';
		}
	}
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-4">
	<div class="text-center">
		<h1 class="text-2xl font-bold text-lams-navy">Take attendance</h1>
		<p class="text-sm text-muted-foreground">
			Scan each student's code. Their name and the time are recorded automatically.
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
				<div class="flex gap-2">
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
						No more students can be recorded. Ask your lecturer to change anything that looks wrong.
					</p>
				</Card.Content>
			</Card.Root>
		{:else if lastResult}
			<Card.Root class="border-emerald-200 bg-emerald-50">
				<Card.Content class="flex items-center gap-3 pt-6">
					<CircleCheck
						class="size-8 shrink-0 {lastResult.status === 'Absent' ? 'text-amber-600' : 'text-emerald-600'}"
						aria-hidden="true"
					/>
					<div class="flex-1">
						<p class="text-sm font-medium">
							{lastResult.name} — {lastResult.status.replace('_', ' ')}
						</p>
						<p class="text-xs text-muted-foreground">Scan the next student.</p>
					</div>
					<Button variant="ghost" size="sm" onclick={() => (lastResult = null)} aria-label="Dismiss">
						<X class="size-4" />
					</Button>
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title>Scan a student</Card.Title>
				<Card.Description>
					Ask each student to open “My attendance code” and hold it up to this camera.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				<QrScanner onscan={onScan} disabled={busy || closed} />

				<details class="rounded-md border border-border p-3">
					<summary class="cursor-pointer text-sm font-medium">
						Student has no phone, or their camera will not work
					</summary>
					<div class="mt-3 flex flex-col gap-3">
							<form class="grid gap-2 sm:grid-cols-[2fr_1fr_auto]" onsubmit={addManually}>
								<div class="flex flex-col gap-1">
									<Label for="mreg">Registration number</Label>
									<Input id="mreg" bind:value={manualReg} list="scan-roster" placeholder="Type a name or reg number" required />
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
								<Button type="submit" disabled={busy || closed}>Add</Button>
							</div>
						</form>
						<p class="text-xs text-muted-foreground">
							Start typing to pick from the class roster, or type the registration number by hand. They
							must already be enrolled in this subject. Changing this record afterwards is your
							lecturer's job.
						</p>
					</div>
				</details>
			</Card.Content>
		</Card.Root>

		{#if records.length > 0}
			{#if flagged.length > 0}
				<Card.Root class="border-amber-300 bg-amber-50">
					<Card.Header>
						<Card.Title class="text-base">Needs checking ({flagged.length})</Card.Title>
						<Card.Description>
							These records were still created, but something about them did not add up. Tell your lecturer.
						</Card.Description>
					</Card.Header>
					<Card.Content>
						<ul class="flex flex-col gap-2">
							{#each flagged as r (r._id)}
								<li class="text-sm">
									<strong>{r.fullName}</strong>
									<span class="block text-xs text-amber-900">{r.flagReason}</span>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/if}
			<Card.Root>
				<Card.Header>
					<Card.Title>Recorded so far ({records.length})</Card.Title>
					<Card.Description>
						You can undo your own scans while this lecture is open. Anything else is your lecturer's
						decision.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<ul class="flex flex-col divide-y divide-border">
						{#each records as r (r._id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-2">
								<span class="text-sm">
									<strong>{r.fullName}</strong>
									<span class="block text-xs text-muted-foreground">
										{r.regNumber}
										{#if r.recordedBy}· via {r.recordedBy}{/if}
										{#if r.distanceM === null && r.method !== 'absent'}· your location not confirmed{/if}
										{#if r.verification === 'confirmed'}· their location checked{/if}
										{#if r.verification === 'weak'}· location too imprecise to check{/if}
										{#if r.studentDistanceM !== null && r.studentDistanceM !== undefined}
											· they were {r.studentDistanceM} m away
										{/if}
									</span>
								</span>
								<span class="flex items-center gap-2">
									<StatusBadge status={r.status} />
									{#if r.method !== 'absent'}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => undo(r._id)}
											aria-label={`Undo ${r.fullName}`}
										>
											<Undo2 class="size-3.5" /> Undo
										</Button>
									{/if}
								</span>
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>