<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api } from '../../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getAdminPassword, setAdminPassword } from '$lib/lams/admin';
	import { formatCountdown, getCurrentPosition } from '$lib/lams/geo';
	import { parseRosterCsv } from '$lib/lams/csv';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import { ListPlus, TriangleAlert, Trash } from '@lucide/svelte';
	import type { PublicSession } from '$lib/lams/types';

	const REP_KEY = 'lams_rep_name';
	const MIN_ENTRIES = 2;
	const MAX_ENTRIES = 50;

	const sessionId = page.params.sessionId as string;

	interface Entry {
		fullName: string;
		regNumber: string;
		studentId: string;
	}

	function blank(): Entry {
		return { fullName: '', regNumber: '', studentId: '' };
	}

	let unlocked = $state(getAdminPassword().length > 0);
	let password = $state(getAdminPassword());
	let gateError = $state('');
	let unlocking = $state(false);

	let session: PublicSession | null = $state(null);
	let repName = $state('');
	let repRegNumber = $state('');
	let entries = $state<Entry[]>([blank(), blank()]);
	let csvText = $state('');
	let submitting = $state(false);
	let error = $state('');
	let done: { added: number; skipped: number; status: string } | null = $state(null);
	let now = $state(Date.now());
	let timer: ReturnType<typeof setInterval> | null = null;

	// $derived.by reads `session` inside a closure, so it keeps the declared
	// `PublicSession | null` type instead of narrowing to the null initializer.
	const closed = $derived.by(() => {
		const s = session;
		return s ? s.status === 'closed' || now >= s.closesAt : false;
	});
	const filled = $derived(
		entries.filter((e) => e.fullName.trim() && e.regNumber.trim() && e.studentId.trim()).length
	);
	const canSubmit = $derived(!closed && !submitting && filled >= MIN_ENTRIES);

	onMount(() => {
		try {
			const saved = localStorage.getItem(REP_KEY);
			if (saved) {
				try {
					const parsed = JSON.parse(saved) as { name?: string; reg?: string };
					if (parsed.name) repName = parsed.name;
					if (parsed.reg) repRegNumber = parsed.reg;
				} catch {
					// Legacy plain-name entry.
					repName = saved;
				}
			}
		} catch {
			// Storage unavailable — ignore.
		}
		(async () => {
			try {
				const client = requireConvexClient();
				await client.mutation(api.settings.ensureSeed, {});
				const s = await client.query(api.sessions.getPublic, { sessionId: sessionId as never });
				if (s) session = s as unknown as PublicSession;
			} catch {
				// Backend not configured yet; the gate will surface it.
			}
		})();
		timer = setInterval(() => (now = Date.now()), 1000);
		return () => {
			if (timer) clearInterval(timer);
		};
	});

	async function unlock(e: SubmitEvent) {
		e.preventDefault();
		gateError = '';
		unlocking = true;
		try {
			const client = requireConvexClient();
			const res = await client.mutation(api.settings.verifyAdmin, { password });
			if (!res.ok) {
				gateError = 'Wrong password. Ask your lecturer for the shared admin password.';
				return;
			}
			setAdminPassword(password);
			unlocked = true;
		} catch (err) {
			gateError = err instanceof Error ? err.message : 'Unlock failed.';
		} finally {
			unlocking = false;
		}
	}

	function addRow() {
		if (entries.length >= MAX_ENTRIES) return;
		entries = [...entries, blank()];
	}

	function removeRow(i: number) {
		if (entries.length <= MIN_ENTRIES) return;
		entries = entries.filter((_, idx) => idx !== i);
	}

	/** Paste-from-register support: rows fill the table instead of typing. */
	function applyCsv() {
		error = '';
		const rows = parseRosterCsv(csvText).slice(0, MAX_ENTRIES);
		if (rows.length === 0) {
			error = 'No valid rows found. Use: Full Name, Reg Number, Student ID per line.';
			return;
		}
		entries = rows.length >= MIN_ENTRIES ? rows : [...rows, ...Array(MIN_ENTRIES - rows.length).fill(blank())];
		csvText = '';
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		done = null;
		if (closed) {
			error = 'This session has closed — registrations are no longer accepted.';
			return;
		}
		if (!repName.trim()) {
			error = 'Enter your own name so the lecturer knows who submitted this batch.';
			return;
		}
		if (!repRegNumber.trim()) {
			error = 'Enter your own registration number — only flagged class reps may submit.';
			return;
		}
		const valid = entries.filter((r) => r.fullName.trim() && r.regNumber.trim() && r.studentId.trim());
		if (valid.length < MIN_ENTRIES) {
			error = `Enter at least ${MIN_ENTRIES} complete students (name, reg number and student ID each).`;
			return;
		}
		submitting = true;
		try {
			const client = requireConvexClient();
			let lat: number | undefined;
			let lng: number | undefined;
			try {
				const pos = await getCurrentPosition();
				lat = pos.lat;
				lng = pos.lng;
			} catch {
				// Proceed without GPS; the server records the rep submission without distance.
			}
			const res = await client.mutation(api.attendance.submitRepBatch, {
				password: getAdminPassword(),
				sessionId: sessionId as never,
				repName,
				repRegNumber,
				...(lat !== undefined && lng !== undefined ? { repLat: lat, repLng: lng } : {}),
				entries: valid.map((r) => ({
					fullName: r.fullName,
					regNumber: r.regNumber,
					studentId: r.studentId
				}))
			});
			done = res;
			try {
				localStorage.setItem(REP_KEY, JSON.stringify({ name: repName, reg: repRegNumber }));
			} catch {
				// Storage unavailable — ignore.
			}
			entries = [blank(), blank()];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Submission failed.';
		} finally {
			submitting = false;
		}
	}
</script>


<div class="mx-auto flex max-w-2xl flex-col gap-4">
	<div class="flex items-center gap-3">
		<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
		<div>
			<h1 class="text-xl font-bold text-lams-navy">Class rep registration</h1>
			<p class="text-xs text-muted-foreground">
				For students genuinely without a working phone. Your GPS counts as their location proxy and every
				entry is tagged with your name for the lecturer to review.
			</p>
		</div>
	</div>

	{#if session}
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<StatusBadge status={session.status} />
			<span class="text-muted-foreground">
				{session.courseCode}{session.courseTitle ? ` · ${session.courseTitle}` : ''}
				{#if !closed}· closes in {formatCountdown(session.closesAt - now)}{/if}
			</span>
		</div>
	{/if}

	{#if !unlocked}
		<Card.Root>
			<Card.Header>
				<Card.Title>Unlock rep mode</Card.Title>
				<Card.Description>Enter the shared admin password from your lecturer.</Card.Description>
			</Card.Header>
			<Card.Content>
				<form class="flex flex-col gap-4" onsubmit={unlock}>
					<div class="flex flex-col gap-1.5">
						<Label for="pw">Shared admin password</Label>
						<Input id="pw" type="password" bind:value={password} placeholder="Ask your lecturer" required />
					</div>
					{#if gateError}<p class="text-sm text-red-700" role="alert">{gateError}</p>{/if}
					<Button type="submit" disabled={unlocking}>
						{unlocking ? 'Checking…' : 'Unlock rep mode'}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	{:else if closed}
		<Card.Root>
			<Card.Content class="flex flex-col items-center gap-2 py-6 text-center">
				<StatusBadge status="closed" size="lg" />
				<p class="text-sm font-medium">The session has closed — registrations are refused.</p>
				<p class="text-sm text-muted-foreground">
					Class-rep entries are only accepted while the attendance window is open. Ask the lecturer to
					extend or start a new session.
				</p>
			</Card.Content>
		</Card.Root>
	{:else if done}
		<Card.Root>
			<Card.Content class="flex flex-col items-center gap-3 py-6 text-center">
				<ListPlus class="size-10 text-emerald-600" aria-hidden="true" />
				<p class="text-lg font-semibold">{done.added} students registered</p>
				<p class="text-sm text-muted-foreground">
					Status applied to the batch: <strong>{done.status.replace('_', ' ')}</strong> · skipped
					duplicates/incomplete: <strong>{done.skipped}</strong>
				</p>
				<p class="rounded-md border border-border bg-muted p-2 text-xs text-muted-foreground">
					Every entry is recorded as <strong>via rep {repName}</strong> so the lecturer can see exactly who
					submitted it.
				</p>
				<Button onclick={() => (done = null)}>Register more students</Button>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title>Register students</Card.Title>
				<Card.Description>
					Between {MIN_ENTRIES} and {MAX_ENTRIES} students per batch — the whole batch shares your GPS
					reading. Only roster-flagged class reps may submit; every entry is tagged with your name and
					reg number. Paste from a class list, or type row by row.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form class="flex flex-col gap-4" onsubmit={submit}>
					<div class="grid gap-2 md:grid-cols-2">
						<div class="flex flex-col gap-1.5">
							<Label for="repName">Your name (class rep)</Label>
							<Input id="repName" bind:value={repName} placeholder="e.g. Chifundo Rep" required />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="repReg">Your reg number (must be flagged rep)</Label>
							<Input id="repReg" bind:value={repRegNumber} placeholder="e.g. BIT/2024/0001" required />
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="repCsv">Paste from the class list (optional)</Label>
						<textarea
							id="repCsv"
							class="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
							bind:value={csvText}
							placeholder={'Amina Banda, BIT/2024/0123, 2024-0123\nJohn Phiri, BIT/2024/0124, 2024-0124'}
						></textarea>
						<div class="flex justify-end">
							<Button type="button" variant="secondary" size="sm" onclick={applyCsv}>
								Fill rows from text
							</Button>
						</div>
					</div>
					<div class="flex flex-col gap-3">
						{#each entries as row, i (i)}
							<fieldset class="rounded-md border border-border p-3">
								<legend class="px-1 text-xs text-muted-foreground">Student {i + 1}</legend>
								<div class="grid gap-2 md:grid-cols-3">
									<Input bind:value={row.fullName} placeholder="Full name" aria-label={`Student ${i + 1} full name`} />
									<Input bind:value={row.regNumber} placeholder="Reg number" aria-label={`Student ${i + 1} registration number`} />
									<Input bind:value={row.studentId} placeholder="Student ID" aria-label={`Student ${i + 1} student ID`} />
								</div>
								<div class="mt-2 flex justify-end">
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={entries.length <= MIN_ENTRIES}
										onclick={() => removeRow(i)}
									>
										<Trash class="size-3.5" /> Remove
									</Button>
								</div>
							</fieldset>
						{/each}
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="outline"
							onclick={addRow}
							disabled={entries.length >= MAX_ENTRIES}
						>
							<ListPlus class="size-4" /> Add student
						</Button>
						<Button type="submit" disabled={!canSubmit}>
							{submitting ? 'Submitting…' : `Register ${filled} students`}
						</Button>
						<span class="text-xs text-muted-foreground">
							{filled < MIN_ENTRIES ? `At least ${MIN_ENTRIES} complete rows required.` : ''}
						</span>
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
				</form>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
