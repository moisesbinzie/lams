<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import { downloadTextFile, toCsv } from '$lib/lams/csv';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import { Download, Printer } from '@lucide/svelte';
	import { printElement } from '$lib/lams/print';
	import StudentRecordsDialog from '$lib/components/lams/student-records-dialog.svelte';
	import LecturerNav from '$lib/components/lams/lecturer-nav.svelte';
	import type { ClassRow, Offering, ReportRow, Semester } from '$lib/lams/types';
	import { reportError, reportSuccess } from '$lib/lams/notify.svelte';
	import { toast } from 'svelte-sonner';

	let token = getToken();
	let classes = $state<ClassRow[]>([]);
	let semesters = $state<Semester[]>([]);
	let offerings = $state<Offering[]>([]);
	let rows = $state<ReportRow[]>([]);
	let totalLectures = $state(0);
	let classId = $state('');
	let semesterId = $state('');
	let offeringId = $state('');
	let search = $state('');
	let loading = $state(true);
	// Gates the in-page section strip: students who land here see the toast
	// below and no lecturer navigation.
	let role = $state('');

	let belowPct = $derived(rows.filter((r) => r.attendPct < 75).length);
	const average = $derived(
		rows.length ? Math.round(rows.reduce((sum, r) => sum + r.attendPct, 0) / rows.length) : 0
	);
	const visible = $derived(
		rows.filter((r) => {
			const q = search.trim().toLowerCase();
			if (!q) return true;
			return r.fullName.toLowerCase().includes(q) || r.regNumber.toLowerCase().includes(q);
		})
	);

	onMount(async () => {
		if (!token) {
			void goto('/signin');
			return;
		}
		try {
			const client = requireConvexClient();
			const me = (await client.query(api.staff.me, { token })) as { role: string } | null;
			if (!me) {
				endSession();
				void goto('/signin');
				return;
			}
			if (me.role !== 'lecturer') {
				toast.error(
					'Only lecturers can review records here. Your own attendance is on your account page.'
				);
				loading = false;
				return;
			}
			role = me.role;
			[classes, semesters] = await Promise.all([
				client.query(api.academics.listClasses, { token }) as Promise<ClassRow[]>,
				client.query(api.academics.listSemesters, { token }) as Promise<Semester[]>
			]);
			if (!classId && classes.length > 0) classId = classes[0]._id;
			await loadOfferings();
		} catch (err) {
			// Keep the token: a failed load is usually a network blip.
			reportError(err, 'Could not load.');
		} finally {
			loading = false;
		}
	});

	async function loadOfferings() {
		if (!classId) return;
		try {
			const client = requireConvexClient();
			offerings = (await client.query(api.academics.listOfferings, {
				token,
				classId: classId as never
			})) as unknown as Offering[];
			if (!offeringId || !offerings.some((o) => o._id === offeringId)) {
				offeringId = offerings[0]?._id ?? '';
			}
			await loadReport();
		} catch (err) {
			reportError(err, 'Could not load subjects.');
		}
	}

	async function loadReport() {
		if (!offeringId) {
			rows = [];
			return;
		}
		try {
			const client = requireConvexClient();
			const res = (await client.query(api.reports.subjectReport, {
				token,
				offeringId: offeringId as never
			})) as { totalLectures: number; rows: ReportRow[] };
			totalLectures = res.totalLectures;
			rows = res.rows;
		} catch (err) {
			reportError(err, 'Could not load the report.');
		}
	}

	async function excuse(status: 'Excused' | 'Present' | 'Absent') {
		if (!offeringId) return;
		if (!confirm(`Mark everyone below 75% as ${status} for every past lecture in this subject?`)) return;
		try {
			const client = requireConvexClient();
			const targets = rows.filter((r) => r.attendPct < 75).map((r) => r.personId as never);
			if (targets.length === 0) {
				reportSuccess('Nobody is below 75%.');
				return;
			}
			const res = await client.mutation(api.reports.excuseRange, {
				token,
				offeringId: offeringId as never,
				personIds: targets,
				status
			});
			reportSuccess(`${res.changed} record(s) changed.`);
			await loadReport();
		} catch (err) {
			reportError(err, 'Could not change those records.');
		}
	}

	function exportCsv() {
		const csv = toCsv(
			['Name', 'Registration number', 'On time', 'Late', 'Out of range', 'Absent', 'Excused', 'Attendance %'],
			visible.map((r) => [
				r.fullName,
				r.regNumber,
				r.present,
				r.late,
				r.outOfRange,
				r.absent,
				r.excused,
				r.attendPct
			])
		);
		downloadTextFile(`attendance-report-${Date.now()}.csv`, csv);
	}

	// Per-student drill-down: totals plus individual records with overrides.
	let historyFor = $state<ReportRow | null>(null);
	let historyOpen = $state(false);

	$effect(() => {
		if (classId) void loadOfferings();
	});
	$effect(() => {
		if (offeringId) void loadReport();
	});
</script>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
	{#if role === 'lecturer'}
		<LecturerNav />
	{/if}
	<div class="flex items-center gap-3">
		<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
		<div>
			<h1 class="text-xl font-bold text-lams-navy">Attendance records</h1>
			<p class="text-xs text-muted-foreground">
				See how much of each subject everyone has attended, and correct anything that looks wrong.
			</p>
		</div>
	</div>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="cls">Class</Label>
				<Select.Root type="single" value={classId} onValueChange={(v) => (classId = v ?? '')}>
					<Select.Trigger id="cls" class="w-full">
						<Select.Value placeholder="Choose a class" />
					</Select.Trigger>
					<Select.Content>
						<Select.Group>
							{#each classes as c (c._id)}
								<Select.Item value={c._id}>{c.name}</Select.Item>
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="off">Subject</Label>
				<Select.Root type="single" value={offeringId} onValueChange={(v) => (offeringId = v ?? '')}>
					<Select.Trigger id="off" class="w-full">
						<Select.Value placeholder="Choose a subject" />
					</Select.Trigger>
					<Select.Content>
						<Select.Group>
							{#each offerings as o (o._id)}
								<Select.Item value={o._id}>{o.subjectCode} — {o.subjectTitle}</Select.Item>
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		{#if !offerings.length}
			<Card.Root>
				<Card.Content class="pt-6 text-center text-sm text-muted-foreground">
					Offer this class a subject first — reports appear once lectures have been taken.
				</Card.Content>
			</Card.Root>
		{:else}
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
				<div class="rounded-md border border-border p-3 text-center">
					<p class="text-2xl font-bold">{totalLectures}</p>
					<p class="text-xs text-muted-foreground">Lectures taken</p>
				</div>
				<div class="rounded-md border border-border p-3 text-center">
					<p class="text-2xl font-bold text-emerald-700">{average}%</p>
					<p class="text-xs text-muted-foreground">Average attendance</p>
				</div>
				<div class="rounded-md border border-border p-3 text-center">
					<p class="text-2xl font-bold">{rows.length}</p>
					<p class="text-xs text-muted-foreground">Students</p>
				</div>
				<div class="rounded-md border border-border p-3 text-center">
					<p class="text-2xl font-bold text-amber-700">{belowPct}</p>
					<p class="text-xs text-muted-foreground">Below 75%</p>
				</div>
			</div>

			<Card.Root>
				<Card.Content class="flex flex-col gap-3 pt-6">
					<div class="flex flex-wrap items-center gap-2">
						<Input
							class="max-w-xs flex-1"
							bind:value={search}
							placeholder="Search a student"
							aria-label="Search a student"
						/>
						<Button variant="outline" size="sm" onclick={exportCsv} disabled={visible.length === 0}>
							<Download class="size-3.5" /> Download list
						</Button>
						<Button
							variant="outline"
							size="sm"
							onclick={() => printElement('#report-table')}
							disabled={visible.length === 0}
						>
							<Printer class="size-3.5" /> Save as PDF
						</Button>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-xs text-muted-foreground">Bulk change for everyone below 75%:</span>
						<Button variant="outline" size="sm" onclick={() => excuse('Excused')}>Mark excused</Button>
						<Button variant="outline" size="sm" onclick={() => excuse('Present')}>Mark present</Button>
						<Button variant="outline" size="sm" onclick={() => excuse('Absent')}>Mark absent</Button>
					</div>
					<p class="text-xs text-muted-foreground">
						Approved absences (excused) are left out of every percentage, so they never work against a
						student.
					</p>
				</Card.Content>
			</Card.Root>

			{#if visible.length === 0}
				<Card.Root>
					<Card.Content class="pt-6 text-center text-sm text-muted-foreground">
						No lectures have been taken for this subject yet, so there is nothing to report.
					</Card.Content>
				</Card.Root>
			{:else}
				<div class="overflow-x-auto rounded-md border" id="report-table">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Name</Table.Head>
								<Table.Head>Registration number</Table.Head>
								<Table.Head>On time</Table.Head>
								<Table.Head>Late</Table.Head>
								<Table.Head>Out of range</Table.Head>
								<Table.Head>Absent</Table.Head>
								<Table.Head>Excused</Table.Head>
								<Table.Head>Attendance</Table.Head>
								<Table.Head class="text-right">Records</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each visible as r (r.regNumber)}
								<Table.Row class={r.attendPct < 75 ? 'bg-amber-50' : ''}>
									<Table.Cell class="font-medium">{r.fullName}</Table.Cell>
									<Table.Cell class="text-xs">{r.regNumber}</Table.Cell>
									<Table.Cell class="text-xs">{r.present}</Table.Cell>
									<Table.Cell class="text-xs">{r.late}</Table.Cell>
									<Table.Cell class="text-xs">{r.outOfRange}</Table.Cell>
									<Table.Cell class="text-xs">{r.absent}</Table.Cell>
									<Table.Cell class="text-xs">{r.excused}</Table.Cell>
									<Table.Cell>
										<span
											class="font-semibold {r.attendPct < 75 ? 'text-amber-700' : 'text-emerald-700'}"
										>
											{r.attendPct}%
										</span>
									</Table.Cell>
									<Table.Cell class="text-right">
										<Button
											variant="outline"
											size="sm"
											onclick={() => {
												historyFor = r;
												historyOpen = true;
											}}
										>
											History
										</Button>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		{/if}
	{/if}
</div>

<StudentRecordsDialog
	bind:open={historyOpen}
	personId={historyFor?.personId ?? null}
	fullName={historyFor?.fullName ?? ''}
	{token}
	onchanged={loadReport}
/>