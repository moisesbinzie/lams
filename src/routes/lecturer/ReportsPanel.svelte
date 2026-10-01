<script lang="ts">
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { downloadTextFile, toCsv } from '$lib/lams/csv';
	import { printElement } from '$lib/lams/print';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { Printer } from '@lucide/svelte';

	let { password, courseId }: { password: string; courseId: string } = $props();

	interface ReportRow {
		fullName: string;
		regNumber: string;
		studentId: string;
		present: number;
		late: number;
		outOfRange: number;
		absent: number;
		excused: number;
		attendPct: number;
		presentPct: number;
		latePct: number;
		absentPct: number;
		excusedPct: number;
	}

	let totalSessions = $state(0);
	let rows: ReportRow[] = $state([]);
	let error = $state('');

	/** Spec §23 students below a 75% attendance line — flagged, never auto-failed. */
	const belowThreshold = $derived(rows.filter((r) => r.attendPct < 75).length);
	const avgAttend = $derived(
		rows.length ? Math.round(rows.reduce((sum, r) => sum + r.attendPct, 0) / rows.length) : 0
	);

	async function load() {
		if (!courseId) return;
		try {
			const client = requireConvexClient();
			const res = (await client.query(api.attendance.reportByCourse, { password, courseId: courseId as never })) as {
				totalSessions: number;
				rows: ReportRow[];
			};
			totalSessions = res.totalSessions;
			rows = res.rows;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Report failed.';
		}
	}

	function exportCsv() {
		const csv = toCsv(
			[
				'Name',
				'Reg',
				'Student ID',
				'Present',
				'Late',
				'Out of Range',
				'Absent',
				'Excused',
				'Attend %',
				'Present %',
				'Late %',
				'Absent %',
				'Excused %'
			],
			rows.map((r) => [
				r.fullName,
				r.regNumber,
				r.studentId,
				r.present,
				r.late,
				r.outOfRange,
				r.absent,
				r.excused,
				r.attendPct,
				r.presentPct,
				r.latePct,
				r.absentPct,
				r.excusedPct
			])
		);
		downloadTextFile(`lams-report-${courseId}-${Date.now()}.csv`, csv);
	}

	$effect(() => {
		if (courseId && password) load();
	});
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Step 6 — Reports ({totalSessions} closed sessions)</Card.Title>
		<Card.Description>Percentages across closed sessions. Excused is reported separately, never as Absent.</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		<div class="flex flex-wrap gap-1">
			<Button variant="outline" size="sm" onclick={load}>Refresh</Button>
			<Button variant="secondary" size="sm" onclick={exportCsv} disabled={rows.length === 0}>
				Export CSV
			</Button>
			<Button
				variant="outline"
				size="sm"
				disabled={rows.length === 0}
				onclick={() => printElement('#report-table-wrap')}
			>
				<Printer class="size-3.5" /> Print / PDF
			</Button>
		</div>
		{#if rows.length > 0}
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
				<div class="rounded-md border border-border p-2 text-center">
					<p class="text-lg font-bold text-lams-navy">{totalSessions}</p>
					<p class="text-[11px] text-muted-foreground">Closed sessions</p>
				</div>
				<div class="rounded-md border border-border p-2 text-center">
					<p class="text-lg font-bold text-lams-navy">{rows.length}</p>
					<p class="text-[11px] text-muted-foreground">Students</p>
				</div>
				<div class="rounded-md border border-border p-2 text-center">
					<p class="text-lg font-bold text-emerald-700">{avgAttend}%</p>
					<p class="text-[11px] text-muted-foreground">Average attendance</p>
				</div>
				<div class="rounded-md border border-border p-2 text-center">
					<p class="text-lg font-bold {belowThreshold > 0 ? 'text-rose-700' : 'text-emerald-700'}">
						{belowThreshold}
					</p>
					<p class="text-[11px] text-muted-foreground">Below 75%</p>
				</div>
			</div>
		{/if}
		{#if error}<p class="text-sm text-red-700">{error}</p>{/if}
		{#if rows.length === 0}
			<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
				Nothing to report yet — close a session to count it here.
			</p>
		{:else}
			<div id="report-table-wrap" class="max-h-96 overflow-auto rounded-md border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Reg</Table.Head>
							<Table.Head>P</Table.Head>
							<Table.Head>L</Table.Head>
							<Table.Head>OOR</Table.Head>
							<Table.Head>A</Table.Head>
							<Table.Head>E</Table.Head>
							<Table.Head>Attend %</Table.Head>
							<Table.Head>Present %</Table.Head>
							<Table.Head>Excused %</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each rows as r (r.regNumber)}
							<Table.Row class={r.attendPct < 75 ? 'bg-rose-50' : ''}>
								<Table.Cell class="font-medium">{r.fullName}</Table.Cell>
								<Table.Cell class="text-xs">{r.regNumber}</Table.Cell>
								<Table.Cell>{r.present}</Table.Cell>
								<Table.Cell>{r.late}</Table.Cell>
								<Table.Cell>{r.outOfRange}</Table.Cell>
								<Table.Cell>{r.absent}</Table.Cell>
								<Table.Cell>{r.excused}</Table.Cell>
								<Table.Cell class="font-semibold {r.attendPct < 75 ? 'text-rose-700' : ''}">
									{r.attendPct}%
								</Table.Cell>
								<Table.Cell>{r.presentPct}%</Table.Cell>
								<Table.Cell>{r.excusedPct}%</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
