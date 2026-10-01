<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { formatDistance } from '$lib/lams/geo';
	import { formatTime } from '$lib/lams/time';
	import { downloadTextFile, toCsv } from '$lib/lams/csv';
	import { printElement } from '$lib/lams/print';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import * as Select from '$lib/components/ui/select';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import { Printer, RefreshCw, Search } from '@lucide/svelte';
	import type { AttendanceDoc, AttendanceStatus } from '$lib/lams/types';

	let { password, sessionId }: { password: string; sessionId: string } = $props();

	let rows: AttendanceDoc[] = $state([]);
	let error = $state('');
	let filter: 'all' | AttendanceStatus | 'rep' = $state('all');
	let search = $state('');
	let fullName = $state('');
	let regNumber = $state('');
	let studentId = $state('');
	let manualStatus = $state('Present');
	let updatedAt = $state(0);
	let live = $state(false);

	const counts = $derived({
		Present: rows.filter((r) => r.status === 'Present').length,
		Late: rows.filter((r) => r.status === 'Late').length,
		Out_of_Range: rows.filter((r) => r.status === 'Out_of_Range').length,
		Absent: rows.filter((r) => r.status === 'Absent').length,
		Excused: rows.filter((r) => r.status === 'Excused').length
	});

	const visible = $derived(
		rows.filter((r) => {
			if (filter === 'rep' && r.method !== 'rep') return false;
			if (filter !== 'all' && filter !== 'rep' && r.status !== filter) return false;
			const q = search.trim().toLowerCase();
			if (!q) return true;
			return (
				r.fullName.toLowerCase().includes(q) ||
				r.regNumber.toLowerCase().includes(q) ||
				r.studentId.toLowerCase().includes(q)
			);
		})
	);

	async function load() {
		if (!sessionId || !password) return;
		try {
			const client = requireConvexClient();
			rows = (await client.query(api.attendance.listBySession, {
				password,
				sessionId: sessionId as never
			})) as unknown as AttendanceDoc[];
			updatedAt = Date.now();
			live = true;
			error = '';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load attendance.';
		}
	}

	onMount(() => {
		// Live view (spec: the lecturer watches submissions arrive in real time).
		const poll = setInterval(() => void load(), 6000);
		return () => clearInterval(poll);
	});

	$effect(() => {
		if (sessionId && password) void load();
	});

	async function setStatus(id: string, status: AttendanceStatus) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.attendance.override, {
				password,
				attendanceId: id as never,
				status
			});
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Override failed.';
		}
	}

	async function removeRow(id: string) {
		if (!confirm('Remove this record?')) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.attendance.remove, { password, attendanceId: id as never });
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Remove failed.';
		}
	}

	async function addManual(e: SubmitEvent) {
		e.preventDefault();
		try {
			const client = requireConvexClient();
			await client.mutation(api.attendance.manualAdd, {
				password,
				sessionId: sessionId as never,
				fullName,
				regNumber,
				studentId,
				status: manualStatus as 'Present' | 'Late' | 'Out_of_Range' | 'Absent' | 'Excused'
			});
			fullName = '';
			regNumber = '';
			studentId = '';
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Add failed.';
		}
	}

	function exportCsv() {
		const csv = toCsv(
			[
				'Name',
				'Reg',
				'Student ID',
				'Status',
				'Method',
				'Rep',
				'Rep reg',
				'Distance m',
				'GPS accuracy m',
				'Submitted',
				'Overridden by',
				'Previous status'
			],
			visible.map((r) => [
				r.fullName,
				r.regNumber,
				r.studentId,
				r.status,
				r.method,
				r.repName ?? '',
				r.repRegNumber ?? '',
				r.distanceM ?? '',
				r.accuracyM ? Math.round(r.accuracyM) : '',
				new Date(r.submittedAt).toISOString(),
				r.overriddenBy ?? '',
				r.prevStatus ?? ''
			])
		);
		downloadTextFile(`lams-attendance-${sessionId}-${Date.now()}.csv`, csv);
	}
</script>


<Card.Root id="attendance-panel">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			Step 5 — Live attendance ({rows.length})
			<span class="flex items-center gap-1 text-xs font-normal text-muted-foreground">
				<span
					class="size-2 rounded-full {live ? 'animate-pulse bg-emerald-500' : 'bg-neutral-400'}"
					aria-hidden="true"
				></span>
				{live ? 'auto-refreshing every 6 s' : 'live'}
				{#if updatedAt}
					· updated {formatTime(updatedAt)}
				{/if}
			</span>
		</Card.Title>
		<Card.Description>
			Watch submissions arrive, search a student, override any record to Present / Late / Out of Range /
			Absent / Excused, remove mistakes, or add walk-ins manually. Rows without a GPS fix are flagged
			unverified.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
			{#each [
				{ label: 'Present', value: counts.Present, tone: 'text-emerald-700' },
				{ label: 'Late', value: counts.Late, tone: 'text-amber-700' },
				{ label: 'Out of Range', value: counts.Out_of_Range, tone: 'text-rose-700' },
				{ label: 'Absent', value: counts.Absent, tone: 'text-neutral-600' },
				{ label: 'Excused', value: counts.Excused, tone: 'text-sky-700' }
			] as stat}
				<div class="rounded-md border border-border p-2 text-center">
					<p class="text-lg font-bold {stat.tone}">{stat.value}</p>
					<p class="text-[11px] text-muted-foreground">{stat.label}</p>
				</div>
			{/each}
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<div class="relative flex-1 min-w-56">
				<Search
					class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input class="pl-8" bind:value={search} placeholder="Search name, reg number or student ID" />
			</div>
			<Button variant="outline" size="sm" onclick={load} aria-label="Refresh now">
				<RefreshCw class="size-3.5" /> Refresh
			</Button>
			<Button variant="secondary" size="sm" onclick={exportCsv} disabled={visible.length === 0}>
				Export CSV
			</Button>
			<Button variant="outline" size="sm" onclick={() => printElement('#attendance-table-wrap')}>
				<Printer class="size-3.5" /> Print
			</Button>
		</div>

		<div class="flex flex-wrap gap-1">
			{#each [
				{ key: 'all', label: `All (${rows.length})` },
				{ key: 'Present', label: `Present (${counts.Present})` },
				{ key: 'Late', label: `Late (${counts.Late})` },
				{ key: 'Out_of_Range', label: `Out of Range (${counts.Out_of_Range})` },
				{ key: 'Absent', label: `Absent (${counts.Absent})` },
				{ key: 'Excused', label: `Excused (${counts.Excused})` },
				{ key: 'rep', label: `Via rep (${rows.filter((r) => r.method === 'rep').length})` }
			] as chip}
				<Button
					variant={filter === chip.key ? 'default' : 'outline'}
					size="sm"
					onclick={() => (filter = chip.key as typeof filter)}
				>
					{chip.label}
				</Button>
			{/each}
		</div>

		{#if error}
			<p class="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800" role="alert">{error}</p>
		{/if}

		<form class="grid gap-2 md:grid-cols-5" onsubmit={addManual}>
			<Input bind:value={fullName} placeholder="Walk-in name" aria-label="Walk-in name" required />
			<Input bind:value={regNumber} placeholder="Reg number" aria-label="Reg number" required />
			<Input bind:value={studentId} placeholder="Student ID" aria-label="Student ID" required />
			<Select.Root type="single" bind:value={manualStatus}>
				<Select.Trigger><Select.Value placeholder="Status" /></Select.Trigger>
				<Select.Content>
					<Select.Item value="Present">Present</Select.Item>
					<Select.Item value="Late">Late</Select.Item>
					<Select.Item value="Out_of_Range">Out of Range</Select.Item>
					<Select.Item value="Absent">Absent</Select.Item>
					<Select.Item value="Excused">Excused</Select.Item>
				</Select.Content>
			</Select.Root>
			<Button type="submit">Add</Button>
		</form>

		{#if visible.length === 0}
			<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
				{rows.length === 0
					? 'No records yet — students scan the session QR to appear here in real time.'
					: 'No records match this filter or search.'}
			</p>
		{:else}
			<div id="attendance-table-wrap" class="max-h-96 overflow-auto rounded-md border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Reg / ID</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Method</Table.Head>
							<Table.Head>Distance</Table.Head>
							<Table.Head>GPS</Table.Head>
							<Table.Head>Time</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each visible as r (r._id)}
							<Table.Row>
								<Table.Cell class="font-medium">
									{r.fullName}
									{#if r.repName}<span class="text-xs text-muted-foreground">
											(via {r.repName}{r.repRegNumber ? ` · ${r.repRegNumber}` : ''})</span
										>{/if}
								</Table.Cell>
								<Table.Cell class="text-xs">{r.regNumber} · {r.studentId}</Table.Cell>
								<Table.Cell>
									<StatusBadge status={r.status} />
									{#if r.distanceM === undefined || r.distanceM === null}
										<span class="mt-0.5 block text-[11px] font-medium text-amber-700">
											location unverified
										</span>
									{/if}
									{#if r.overriddenBy}
										<span class="block text-[11px] text-muted-foreground">
											overridden{r.prevStatus ? ` from ${r.prevStatus.replace(/_/g, ' ')}` : ''}
										</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-xs">{r.method}</Table.Cell>
								<Table.Cell class="text-xs">{formatDistance(r.distanceM)}</Table.Cell>
								<Table.Cell class="text-xs">
									{r.accuracyM ? `±${Math.round(r.accuracyM)} m` : '—'}
								</Table.Cell>
								<Table.Cell class="text-xs">{formatTime(r.submittedAt)}</Table.Cell>
								<Table.Cell class="text-right">
									<div class="flex flex-wrap justify-end gap-1">
										<Button variant="outline" size="sm" onclick={() => setStatus(r._id, 'Present')}>
											Present
										</Button>
										<Button variant="outline" size="sm" onclick={() => setStatus(r._id, 'Late')}>
											Late
										</Button>
										<Button variant="outline" size="sm" onclick={() => setStatus(r._id, 'Absent')}>
											Absent
										</Button>
										<Button variant="outline" size="sm" onclick={() => setStatus(r._id, 'Excused')}>
											Excused
										</Button>
										<Button variant="ghost" size="sm" onclick={() => removeRow(r._id)}>Remove</Button>
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
			<p class="text-xs text-muted-foreground">
				Showing {visible.length} of {rows.length} record(s). Overrides are stored on the record with the
				previous status for audit.
			</p>
		{/if}
	</Card.Content>
</Card.Root>

