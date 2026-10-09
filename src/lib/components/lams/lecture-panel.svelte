<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import { formatCountdown, getCurrentPosition } from '$lib/lams/geo';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import type { LectureSession, Offering } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';
	import { toast } from 'svelte-sonner';

	let token = getToken();
	let offerings = $state<Offering[]>([]);
	let sessions = $state<LectureSession[]>([]);
	let offeringId = $state('');
	let busy = $state(false);
	let loading = $state(true);
	let now = $state(Date.now());

	let lat = $state('');
	let lng = $state('');
	// Where the screen stands, when that is not simply the lecture position.
	let stationLat = $state('');
	let stationLng = $state('');
	let radius = $state('50');
	// How far the screen may be carried from its spot before scanning stops.
	let tolerance = $state('15');
	// The three-tier window: on time, late, then too late to count.
	let onTimeMin = $state('5');
	let lateUntilMin = $state('10');

	const selected = $derived(offerings.find((o) => o._id === offeringId) ?? null);
	const openSessions = $derived(sessions.filter((s) => s.status === 'open'));

	onMount(() => {
		if (!token) return;
		const tick = setInterval(() => (now = Date.now()), 1000);
		void load();
		return () => clearInterval(tick);
	});

	async function load() {
		if (!token) return;
		loading = true;
		try {
			const client = requireConvexClient();
			const me = (await client.query(api.staff.me, { token })) as {
				kind: string;
				role: string;
			} | null;
			if (!me || me.kind !== 'staff') {
				if (!me) endSession();
				else toast.error('Only lecturers start lectures here. Program reps use “Take attendance”.');
				return;
			}
			if (me.role !== 'lecturer' && me.role !== 'admin') {
				toast.error('Only lecturers start lectures here. Program reps use “Take attendance”.');
				return;
			}
			// Scoped server-side: lecturers get only their assigned offerings,
			// admins get everything. No program picker needed — each offering
			// already carries its program.
			offerings = (await client.query(api.academics.listOfferings, { token })) as unknown as Offering[];
			if (!offeringId || !offerings.some((o) => o._id === offeringId)) {
				offeringId = offerings[0]?._id ?? '';
			}
			await loadSessions();
		} catch (err) {
			// Keep the token: a failed load is usually a network blip.
			reportError(err, 'Could not load.');
		} finally {
			loading = false;
		}
	}

	async function loadSessions() {
		try {
			const client = requireConvexClient();
			sessions = (await client.query(api.attendance.listForRecordKeeper, { token })) as unknown as LectureSession[];
		} catch {
			// Non-fatal.
		}
	}

	async function useGps() {
		try {
			const pos = await getCurrentPosition();
			lat = String(pos.lat);
			lng = String(pos.lng);
			reportSuccess(
							`Lecture location captured to within ${Math.round(pos.accuracyM ?? 0)} metres.`,
							6000
						);
		} catch (err) {
			reportError(err, 'Could not get your location.');
		}
	}

	async function pinStationHere() {
		try {
			const pos = await getCurrentPosition();
			stationLat = pos.lat.toFixed(6);
			stationLng = pos.lng.toFixed(6);
			reportSuccess('Station pinned to where you are standing.', 6000);
		} catch (err) {
			reportError(err, 'Could not get your location.');
		}
	}

	async function start(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			const res = await client.mutation(api.attendance.startSession, {
				token,
				offeringId: offeringId as never,
				lectureLat: Number(lat),
				lectureLng: Number(lng),
				radiusM: Number(radius),
				stationRadiusM: Number(radius),
				stationToleranceM: Number(tolerance),
				// Blank station fields mean "same as the lecture", so nothing is sent
				// and the server falls back to the lecture position.
				...(stationLat.trim() === '' || stationLng.trim() === ''
					? {}
					: { stationLat: Number(stationLat), stationLng: Number(stationLng) }),
				onTimeSec: Math.round(Number(onTimeMin) * 60),
				lateUntilSec: Math.round(Number(lateUntilMin) * 60)
			});
			// Both variants are a receipt plus a next step ("now go and scan students
			// in"), so they are held long enough to be read and acted on.
			reportSuccess(
				res.closedOthers > 0
					? 'Lecture started. An earlier open lecture was closed automatically.'
					: 'Lecture started. Open “Take attendance” to start scanning students in.',
				7000
			);
			await loadSessions();
		} catch (err) {
			reportError(err, 'Could not start the lecture.');
		} finally {
			busy = false;
		}
	}

</script>

<div class="flex flex-col gap-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>Start a lecture</Card.Title>
			<Card.Description>
				Pick one of your assigned courses, share your location, and start. The lecture closes itself.
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col gap-4">
			{#if loading}
				<div class="h-24 animate-pulse rounded-md bg-muted"></div>
			{:else if offerings.length === 0}
				<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
					No courses assigned to you yet. Ask the admin to assign your subjects in the admin console.
				</p>
			{:else}
				<div class="flex flex-col gap-1.5">
					<Label for="off">Course</Label>
					<Select.Root
						type="single"
						value={offeringId}
						onValueChange={(v) => (offeringId = v ?? '')}
						items={offerings.map((o) => ({
							value: o._id,
							label: `${o.courseCode} — ${o.courseTitle} · ${o.programName}`
						}))}
					>
						<Select.Trigger id="off" class="w-full">
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
					{#if selected}
						<p class="text-xs text-muted-foreground">
							{selected.programName} · {selected.semesterName} · {selected.studentCount} student(s) enrolled
						</p>
					{/if}
				</div>

				<div class="rounded-md border border-border p-3">
					<p class="mb-2 text-sm font-medium">Where is the lecture?</p>
					<div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
						<div class="flex flex-col gap-1">
							<Label for="la">Latitude</Label>
							<Input id="la" bind:value={lat} placeholder="-13.9626" required />
						</div>
						<div class="flex flex-col gap-1">
							<Label for="lo">Longitude</Label>
							<Input id="lo" bind:value={lng} placeholder="33.7741" required />
						</div>
						<div class="flex items-end">
							<Button type="button" variant="outline" onclick={useGps}>Use my location</Button>
						</div>
					</div>
				</div>

				<details class="rounded-md border border-border p-3">
					<summary class="cursor-pointer text-sm font-medium">Advanced: screen position and timing</summary>
					<p class="mt-1 text-xs text-muted-foreground">
						Defaults work for most halls (50 m radius, 5 min on time, 10 min late). Open only when the
						screen sits away from you or you need a wider window.
					</p>
					<div class="mt-3 flex flex-col gap-3">
						<div>
							<p class="mb-2 text-sm font-medium">Where is the screen?</p>
							<p class="mb-2 text-xs text-muted-foreground">
								Leave empty when the screen stands where the lecture is.
							</p>
							<div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
								<div class="flex flex-col gap-1">
									<Label for="stla">Station latitude</Label>
									<Input id="stla" bind:value={stationLat} placeholder="same as lecture" />
								</div>
								<div class="flex flex-col gap-1">
									<Label for="stlo">Station longitude</Label>
									<Input id="stlo" bind:value={stationLng} placeholder="same as lecture" />
								</div>
								<div class="flex items-end">
									<Button type="button" variant="outline" onclick={pinStationHere}>Screen is where I am</Button>
								</div>
							</div>
							<div class="mt-2 flex flex-col gap-1 sm:max-w-40">
								<Label for="tol">Screen may move (m)</Label>
								<Input id="tol" type="number" min="1" max={radius} bind:value={tolerance} />
							</div>
						</div>

						<div>
							<p class="mb-2 text-sm font-medium">Attendance rules</p>
							<div class="grid gap-2 sm:grid-cols-3">
								<div class="flex flex-col gap-1">
									<Label for="rad">Allowed distance (m)</Label>
									<Input id="rad" type="number" min="5" max="2000" bind:value={radius} />
								</div>
								<div class="flex flex-col gap-1">
									<Label for="ont">On time for (min)</Label>
									<Input id="ont" type="number" min="0.5" max="60" step="0.5" bind:value={onTimeMin} />
								</div>
								<div class="flex flex-col gap-1">
									<Label for="lat2">Late until (min)</Label>
									<Input id="lat2" type="number" min="1" max="120" step="0.5" bind:value={lateUntilMin} />
								</div>
							</div>
							<p class="mt-2 text-xs text-muted-foreground">
								On time for {onTimeMin} minute(s), then late until {lateUntilMin} minute(s). Anyone scanned
								after that is recorded as absent.
							</p>
						</div>
					</div>
				</details>

				<form onsubmit={start}>
					<Button type="submit" disabled={busy || !offeringId || !lat || !lng}>
						{busy ? 'Starting…' : 'Start lecture'}
					</Button>
				</form>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if openSessions.length > 0}
		<Card.Root class="border-emerald-200">
			<Card.Header>
				<Card.Title>Open right now</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-2">
				{#each openSessions as s (s._id)}
					<div class="flex flex-wrap items-center justify-between gap-2 text-sm">
						<span>
							<strong>{s.courseCode}</strong> — {s.courseTitle}
							<span class="text-xs text-muted-foreground">· {s.programName}</span>
							{#if (s.flaggedCount ?? 0) > 0 || (s.disputedCount ?? 0) > 0}
								<span class="text-xs font-medium text-amber-700">
									· needs review{#if (s.disputedCount ?? 0) > 0} ({s.disputedCount} disputed){/if}{#if (s.flaggedCount ?? 0) > 0} ({s.flaggedCount} flagged){/if}
								</span>
							{/if}
						</span>
						<span class="flex items-center gap-2">
							<StatusBadge status="open" />
							<span class="text-xs">closes in {formatCountdown(s.closesAt - now)}</span>
							<Button size="sm" href="/scan">Scan students</Button>
						</span>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>Recent lectures</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if sessions.length === 0}
				<p class="text-sm text-muted-foreground">No lectures started yet for your subjects.</p>
			{:else}
				<ul class="flex flex-col divide-y divide-border">
					{#each sessions.slice(0, 15) as s (s._id)}
						<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
							<span>
								<strong>{s.courseCode}</strong>
								<span class="text-muted-foreground">
									· {s.programName} · {new Date(s.startedAt).toLocaleString()}
								</span>
							</span>
							<span class="flex items-center gap-2">
								<StatusBadge status={s.status} />
								{#if (s.disputedCount ?? 0) > 0}
									<span class="text-xs font-medium text-red-700">{s.disputedCount} disputed</span>
								{/if}
								<Button size="sm" variant="outline" href="/scan">Open</Button>
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>
</div>