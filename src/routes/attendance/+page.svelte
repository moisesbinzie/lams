<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import { downloadTextFile, toCsv } from '$lib/lams/csv';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import { Download } from '@lucide/svelte';
	import type { MyAttendanceRow, Semester } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';
	import StudentNav from '$lib/components/lams/student-nav.svelte';

	type Summary = {
		totalLectures: number;
		present: number;
		late: number;
		outOfRange: number;
		absent: number;
		excused: number;
		attendPct: number;
	};

	let token = $state('');
	let rows = $state<MyAttendanceRow[]>([]);
	let summary = $state<Summary | null>(null);
	let semesters = $state<Semester[]>([]);
	let semesterId = $state('');
	let from = $state('');
	let to = $state('');
	let statusFilter = $state('');
	let search = $state('');
	let loading = $state(true);
	let disputing = $state<string | null>(null);
	let disputeNote = $state('');

	/**
	 * bits-ui will not take an empty string as a select item's value, so "every
	 * status" travels through the menu as a sentinel and is mapped back to the
	 * empty filter at both edges.
	 */
	const ALL_STATUSES = 'all';

	const visible = $derived(
		rows.filter((r) => {
			if (statusFilter && r.status !== statusFilter) return false;
			const q = search.trim().toLowerCase();
			if (!q) return true;
			return (
				r.courseCode.toLowerCase().includes(q) ||
				r.courseTitle.toLowerCase().includes(q) ||
				r.isoDate.includes(q)
			);
		})
	);

	async function load() {
		const t = token || getToken();
		token = t;
		if (!t) {
			void goto('/signin');
			return;
		}
		try {
			const client = requireConvexClient();
			const scope = {
				token: t,
				...(semesterId ? { semesterId: semesterId as never } : {}),
				...(from ? { from } : {}),
				...(to ? { to } : {})
			};
			[rows, summary] = await Promise.all([
				client.query(api.attendance.myAttendance, scope) as Promise<MyAttendanceRow[]>,
				client.query(api.reports.mySummary, scope) as Promise<Summary>
			]);
		} catch (err) {
			// Keep the token: a failed load is usually a network blip.
			reportError(err, 'Could not load your attendance.');
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		token = getToken();
		if (!token) {
			void goto('/signin');
			return;
		}
		try {
			const client = requireConvexClient();
			semesters = (await client.query(api.academics.listSemesters, { token })) as unknown as Semester[];
		} catch {
			// The filter is optional; the list can stay empty.
		}
		await load();
	});

	function exportCsv() {
		const csv = toCsv(
				['Date', 'Course', 'Course name', 'Status', 'How it was recorded', 'Recorded by'],
			visible.map((r) => [r.isoDate, r.courseCode, r.courseTitle, r.status, r.method, r.recordedBy ?? ''])
		);
		downloadTextFile(`my-attendance-${Date.now()}.csv`, csv);
	}

	async function sendDispute(row: MyAttendanceRow) {
		try {
			const client = requireConvexClient();
			await client.mutation(api.attendance.dispute, {
				token,
				attendanceId: row._id as never,
				note: disputeNote
			});
			row.disputed = true;
			row.disputeNote = disputeNote;
			disputing = null;
			disputeNote = '';
			reportSuccess('Thanks — your lecturer will check this and correct it if it is wrong.');
		} catch (err) {
			reportError(err, 'Could not send your report.');
		}
	}
</script>

	<StudentNav />
	<div class="text-center">
		<h1 class="text-2xl font-bold text-lams-navy">My attendance</h1>
		<p class="text-sm text-muted-foreground">
			Everything recorded in your name, and who recorded it. Check it any time.
		</p>
	</div>

	{#if loading}
		<Card.Root aria-busy="true">
			<Card.Content class="pt-6">
				<p class="text-sm text-muted-foreground">Loading your record…</p>
			</Card.Content>
		</Card.Root>
	{:else}
		{#if summary && summary.totalLectures > 0}
			<!--
				Four columns, not six: the site column is 768 px, so a six-column
				state would give these ~118 px cells and never actually apply.
			-->
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded-md border border-border p-3 text-center">
					<p class="text-2xl font-bold text-emerald-700">{summary.attendPct}%</p>
					<p class="text-xs text-muted-foreground">Attendance</p>
				</div>
				{#each [{ label: 'Lectures', value: summary.totalLectures, tone: '' }, { label: 'On time', value: summary.present, tone: 'text-emerald-700' }, { label: 'Late', value: summary.late, tone: 'text-amber-700' }, { label: 'Out of range', value: summary.outOfRange, tone: 'text-rose-700' }, { label: 'Absent', value: summary.absent, tone: 'text-neutral-600' }, { label: 'Excused', value: summary.excused, tone: 'text-sky-700' }] as stat (stat.label)}
					<div class="rounded-md border border-border p-3 text-center">
						<p class="text-2xl font-bold {stat.tone}">{stat.value}</p>
						<p class="text-xs text-muted-foreground">{stat.label}</p>
					</div>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">
				Approved absences (excused) are left out of the calculation, so they never count against you.
			</p>
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Filter</Card.Title>
				<Card.Description>Check one semester, one month, or one week.</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				<div class="grid gap-4 sm:grid-cols-3">
					<div class="flex flex-col gap-1.5">
						<Label for="sem">Semester</Label>
						<Select.Root
							type="single"
							value={semesterId}
							onValueChange={(v) => {
								semesterId = v ?? '';
								void load();
							}}
							items={semesters.map((s) => ({ value: s._id, label: s.name }))}
						>
							<Select.Trigger id="sem" class="w-full">
								<Select.Value placeholder={semesters.length ? 'Whole time at school' : 'No semesters yet'} />
							</Select.Trigger>
							<Select.Content>
								{#each semesters as s (s._id)}
									<Select.Item value={s._id} label={s.name}>{s.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<DatePicker id="from" label="From" bind:value={from} onchange={load} />
					<DatePicker id="to" label="To" bind:value={to} onchange={load} />
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<Input
						class="max-w-xs flex-1"
						bind:value={search}
							placeholder="Search a course or date"
						aria-label="Search"
					/>
					<Select.Root
						type="single"
						value={statusFilter || ALL_STATUSES}
						onValueChange={(v) => {
							statusFilter = v === ALL_STATUSES ? '' : (v ?? '');
						}}
						items={[
							{ value: ALL_STATUSES, label: 'All statuses' },
							{ value: 'Present', label: 'On time' },
							{ value: 'Late', label: 'Late' },
							{ value: 'Out_of_Range', label: 'Out of range' },
							{ value: 'Absent', label: 'Absent' },
							{ value: 'Excused', label: 'Excused' }
						]}
					>
						<Select.Trigger class="w-44 shrink-0" aria-label="Filter by status">
							<Select.Value placeholder="All statuses" />
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								<Select.Item value={ALL_STATUSES} label="All statuses">All statuses</Select.Item>
								<Select.Item value="Present" label="On time">On time</Select.Item>
								<Select.Item value="Late" label="Late">Late</Select.Item>
								<Select.Item value="Out_of_Range" label="Out of range">Out of range</Select.Item>
								<Select.Item value="Absent" label="Absent">Absent</Select.Item>
								<Select.Item value="Excused" label="Excused">Excused</Select.Item>
							</Select.Group>
						</Select.Content>
					</Select.Root>
					<Button variant="outline" size="sm" onclick={exportCsv} disabled={visible.length === 0}>
						<Download class="size-3.5" /> Download
					</Button>
					{#if semesterId || from || to}
						<Button
							variant="ghost"
							size="sm"
							onclick={() => {
								semesterId = '';
								from = '';
								to = '';
								void load();
							}}
						>
							Clear
						</Button>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>

		{#if visible.length === 0}
			<Card.Root>
				<Card.Content class="pt-6 text-center text-sm text-muted-foreground">
					{rows.length === 0
						? 'No lectures recorded yet. Your lecturer will start taking attendance soon.'
						: 'Nothing matches that filter or search.'}
				</Card.Content>
			</Card.Root>
		{:else}
			<div class="overflow-x-auto rounded-md border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Date</Table.Head>
							<Table.Head>Course</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Recorded by</Table.Head>
							<Table.Head></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each visible as r (r._id)}
							<Table.Row>
								<Table.Cell class="text-xs">{r.isoDate}</Table.Cell>
								<Table.Cell class="text-xs">
									<strong>{r.courseCode}</strong>
									<span class="block text-muted-foreground">{r.courseTitle}</span>
								</Table.Cell>
								<Table.Cell><StatusBadge status={r.status} /></Table.Cell>
								<Table.Cell class="text-xs">{r.recordedBy ?? 'Nobody'}</Table.Cell>
								<Table.Cell class="text-right">
									{#if r.disputed}
										<span class="text-xs font-medium text-amber-700">Reported</span>
									{:else if r.method !== 'absent'}
										<Button
											variant="ghost"
											size="sm"
											onclick={() => {
												disputing = disputing === r._id ? null : r._id;
												disputeNote = '';
											}}
										>
											This wasn't me
										</Button>
									{/if}
								</Table.Cell>
							</Table.Row>
							{#if disputing === r._id}
								<Table.Row>
									<Table.Cell colspan={5} class="bg-muted/40">
										<form
											class="flex flex-col gap-2 sm:flex-row sm:items-end"
											onsubmit={(e) => {
												e.preventDefault();
												sendDispute(r);
											}}
										>
											<div class="flex flex-1 flex-col gap-1">
												<Label for={`n-${r._id}`}>What went wrong?</Label>
												<Input
													id={`n-${r._id}`}
													bind:value={disputeNote}
													placeholder="e.g. I was not in the hall that day"
												/>
											</div>
											<Button type="submit" size="sm">Send to lecturer</Button>
										</form>
									</Table.Cell>
								</Table.Row>
							{/if}
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	{/if}