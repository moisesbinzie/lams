<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getAdminPassword } from '$lib/lams/admin';
	import { downloadTextFile, toCsv } from '$lib/lams/csv';
	import { formatDistance } from '$lib/lams/geo';
	import { formatDateTime, formatTime } from '$lib/lams/time';
	import { printElement } from '$lib/lams/print';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import AdminGate from '$lib/components/lams/admin-gate.svelte';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import { FileText, Printer, Search } from '@lucide/svelte';
	import type { AttendanceDoc, AttendanceStatus, CourseDoc, SessionDoc, TermDoc } from '$lib/lams/types';

	let password = $state(getAdminPassword());
	let terms = $state<TermDoc[]>([]);
	let courses = $state<CourseDoc[]>([]);
	let sessions = $state<SessionDoc[]>([]);
	let termId = $state('');
	let courseId = $state('');
	let sessionId = $state('');

	let rows = $state<AttendanceDoc[]>([]);
	let search = $state('');
	let filter = $state<'all' | AttendanceStatus>('all');
	let reportTotal = $state(0);
	let error = $state('');
	let loading = $state(false);

	const currentCourse = $derived(courses.find((c) => c._id === courseId) ?? null);
	const currentSession = $derived(sessions.find((s) => s._id === sessionId) ?? null);

	const counts = $derived({
		Present: rows.filter((r) => r.status === 'Present').length,
		Late: rows.filter((r) => r.status === 'Late').length,
		Out_of_Range: rows.filter((r) => r.status === 'Out_of_Range').length,
		Absent: rows.filter((r) => r.status === 'Absent').length,
		Excused: rows.filter((r) => r.status === 'Excused').length
	});

	const visible = $derived(
		rows.filter((r) => {
			if (filter !== 'all' && r.status !== filter) return false;
			const q = search.trim().toLowerCase();
			if (!q) return true;
			return (
				r.fullName.toLowerCase().includes(q) ||
				r.regNumber.toLowerCase().includes(q) ||
				r.studentId.toLowerCase().includes(q)
			);
		})
	);

	function pickSession(value: string) {
		sessionId = value;
	}

	async function loadTermsAndCourses() {
		if (!password) return;
		error = '';
		try {
			const client = requireConvexClient();
			terms = (await client.query(api.terms.list, {})) as unknown as TermDoc[];
			if (!termId && terms.length > 0) termId = terms[0]._id;
			courses = (await client.query(
				api.courses.list,
				termId ? { termId: termId as never } : {}
			)) as unknown as CourseDoc[];
			if (courseId && !courses.some((c) => c._id === courseId)) {
				courseId = '';
				sessionId = '';
			}
			if (!courseId && courses.length > 0) courseId = courses[0]._id;
			await loadCourseData();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Load failed.';
		}
	}

	async function loadCourseData() {
		if (!courseId) return;
		loading = true;
		try {
			const client = requireConvexClient();
			sessions = (await client.query(api.sessions.listByCourse, {
				courseId: courseId as never
			})) as unknown as SessionDoc[];
			if (sessionId && !sessions.some((s) => s._id === sessionId)) sessionId = '';
			const report = (await client.query(api.attendance.reportByCourse, {
				password,
				courseId: courseId as never
			})) as { totalSessions: number };
			reportTotal = report.totalSessions;
			await loadAttendance();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Load failed.';
		} finally {
			loading = false;
		}
	}

	async function loadAttendance() {
		if (!sessionId || !password) {
			rows = [];
			return;
		}
		try {
			const client = requireConvexClient();
			rows = (await client.query(api.attendance.listBySession, {
				password,
				sessionId: sessionId as never
			})) as unknown as AttendanceDoc[];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load records.';
		}
	}

	function selectTerm(value: string) {
		termId = value;
		courseId = '';
		sessionId = '';
		void loadTermsAndCourses();
	}

	function selectCourse(value: string) {
		courseId = value;
		sessionId = '';
		void loadCourseData();
	}

	function exportSessionCsv() {
		if (visible.length === 0) return;
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
		downloadTextFile(`lams-records-${sessionId}-${Date.now()}.csv`, csv);
	}

	onMount(() => {
		if (password) void loadTermsAndCourses();
	});
</script>


<div class="flex flex-col gap-4">
	<div class="flex items-center gap-3">
		<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
		<div>
			<h1 class="text-xl font-bold text-lams-navy">Records review</h1>
			<p class="text-xs text-muted-foreground">
				Read-only inspection of past attendance — filter, search, export CSV or print any session.
			</p>
		</div>
	</div>

	<AdminGate
		title="Unlock records"
		description="Attendance records are staff-only. Use the same shared admin password as the lecturer console."
		onUnlock={(pw) => {
			password = pw;
			if (pw) void loadTermsAndCourses();
		}}
	/>

	{#if error}
		<Card.Root class="border-red-200">
			<Card.Content class="pt-6 text-sm text-red-700" role="alert">{error}</Card.Content>
		</Card.Root>
	{/if}

	{#if password}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<FileText class="size-5 text-lams-navy" /> Choose what to review
				</Card.Title>
				<Card.Description>
					Reports cover closed sessions only; live sessions are still visible while they run.
					{#if loading}<span class="text-muted-foreground">Loading…</span>{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-3 md:grid-cols-3">
				<div class="flex flex-col gap-1.5">
					<Label for="recTerm">Term</Label>
					<Select.Root type="single" value={termId} onValueChange={(v) => v && selectTerm(v)}>
						<Select.Trigger id="recTerm" class="w-full">
							<Select.Value placeholder={terms.length ? 'Select term' : 'No terms yet'} />
						</Select.Trigger>
						<Select.Content>
							{#each terms as t (t._id)}
								<Select.Item value={t._id}>{t.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="recCourse">Course</Label>
					<Select.Root type="single" value={courseId} onValueChange={(v) => v && selectCourse(v)}>
						<Select.Trigger id="recCourse" class="w-full">
							<Select.Value placeholder={courses.length ? 'Select course' : 'No courses'} />
						</Select.Trigger>
						<Select.Content>
							{#each courses as c (c._id)}
								<Select.Item value={c._id}>{c.code} — {c.title}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="recSession">Session</Label>
					<Select.Root type="single" value={sessionId} onValueChange={(v) => v && pickSession(v)}>
						<Select.Trigger id="recSession" class="w-full">
							<Select.Value placeholder={sessions.length ? 'Select session' : 'No sessions yet'} />
						</Select.Trigger>
						<Select.Content>
							{#each sessions as s (s._id)}
								<Select.Item value={s._id}>
									{s.status === 'open' ? '●' : '○'} {formatDateTime(s.startedAt)}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</Card.Content>
		</Card.Root>

		{#if !courseId}
			<Card.Root>
				<Card.Content class="pt-6 text-center text-sm text-muted-foreground">
					Pick a term and course above — the roster report and session records will appear here.
				</Card.Content>
			</Card.Root>
		{:else if currentSession}
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex flex-wrap items-center gap-2">
						<StatusBadge status={currentSession.status} />
						Session of {formatDateTime(currentSession.startedAt)}
						<span class="text-sm font-normal text-muted-foreground">
							{currentCourse ? `${currentCourse.code} · ` : ''}{rows.length} record(s)
							{#if reportTotal > 0}· {reportTotal} closed session(s) in report{/if}
						</span>
					</Card.Title>
					<Card.Description>
						Window {formatTime(currentSession.startedAt)} → {formatTime(currentSession.closesAt)} ·
						{Math.round(currentSession.presentSec / 60)} min Present window · radius
						{currentSession.radiusM} m. Read-only: corrections happen on the lecturer console.
					</Card.Description>
				</Card.Header>
				<Card.Content class="flex flex-col gap-3">
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
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
						<div class="relative min-w-56 flex-1">
							<Search
								class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input class="pl-8" bind:value={search} placeholder="Search name, reg or student ID" />
						</div>
						<Select.Root type="single" bind:value={filter}>
							<Select.Trigger class="w-44">
								<Select.Value placeholder="Status filter" />
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="all">All statuses</Select.Item>
								<Select.Item value="Present">Present</Select.Item>
								<Select.Item value="Late">Late</Select.Item>
								<Select.Item value="Out_of_Range">Out of Range</Select.Item>
								<Select.Item value="Absent">Absent</Select.Item>
								<Select.Item value="Excused">Excused</Select.Item>
							</Select.Content>
						</Select.Root>
						<Button variant="secondary" size="sm" disabled={visible.length === 0} onclick={exportSessionCsv}>
							Export CSV
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={visible.length === 0}
							onclick={() => printElement('#records-table-wrap')}
						>
							<Printer class="size-3.5" /> Print
						</Button>
					</div>

					{#if visible.length === 0}
						<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
							{rows.length === 0
								? 'No records were captured for this session.'
								: 'No records match the current search or status filter.'}
						</p>
					{:else}
						<div id="records-table-wrap" class="max-h-96 overflow-auto rounded-md border">
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head>Name</Table.Head>
										<Table.Head>Reg / ID</Table.Head>
										<Table.Head>Status</Table.Head>
										<Table.Head>Method</Table.Head>
										<Table.Head>Distance</Table.Head>
										<Table.Head>GPS</Table.Head>
										<Table.Head>Submitted</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each visible as r (r._id)}
										<Table.Row>
											<Table.Cell class="font-medium">
												{r.fullName}
												{#if r.repName}
													<span class="text-xs text-muted-foreground">
														(via {r.repName}{r.repRegNumber ? ` · ${r.repRegNumber}` : ''})</span
													>
												{/if}
											</Table.Cell>
											<Table.Cell class="text-xs">{r.regNumber} · {r.studentId}</Table.Cell>
											<Table.Cell>
												<StatusBadge status={r.status} />
												{#if r.overriddenBy}
													<span class="block text-[11px] text-muted-foreground">
														by {r.overriddenBy}{r.prevStatus
															? ` from ${r.prevStatus.replace(/_/g, ' ')}`
															: ''}
													</span>
												{/if}
											</Table.Cell>
											<Table.Cell class="text-xs">{r.method}</Table.Cell>
											<Table.Cell class="text-xs">{formatDistance(r.distanceM)}</Table.Cell>
											<Table.Cell class="text-xs">
												{r.accuracyM ? `±${Math.round(r.accuracyM)} m` : '—'}
											</Table.Cell>
											<Table.Cell class="text-xs">{formatTime(r.submittedAt)}</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</div>
						<p class="text-xs text-muted-foreground">
							Showing {visible.length} of {rows.length} record(s) · export copies the filtered view.
						</p>
					{/if}
				</Card.Content>
			</Card.Root>
		{:else}
			<Card.Root>
				<Card.Content class="pt-6 text-center text-sm text-muted-foreground">
					{sessions.length === 0
						? 'This course has no sessions yet — records appear once a session runs.'
						: `Pick a session above to inspect its ${sessions.length} session record(s). Course report covers ${reportTotal} closed session(s).`}
				</Card.Content>
			</Card.Root>
		{/if}
	{:else}
		<Card.Root>
			<Card.Content class="flex flex-col items-center gap-3 py-8 text-center">
				<FileText class="size-9 text-muted-foreground/60" />
				<p class="text-sm font-medium">Records are locked.</p>
				<p class="max-w-md text-sm text-muted-foreground">
					Unlock with the shared admin password to review every session's attendance, inspect overrides and
					their audit trail, and export CSV or print registers for your files.
				</p>
			</Card.Content>
		</Card.Root>
	{/if}
</div>

