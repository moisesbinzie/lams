<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { formatDateTime } from '$lib/lams/time';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import { Flag, TriangleAlert } from '@lucide/svelte';
	import type { AttendanceStatus } from '$lib/lams/types';
	import { reportError } from '$lib/lams/notify.svelte';

	interface CourseBucket {
		courseId: string;
		courseCode: string;
		courseTitle: string;
		lectures: number;
		present: number;
		late: number;
		outOfRange: number;
		absent: number;
		excused: number;
		attendPct: number;
	}

	interface RecordRow {
		_id: string;
		courseCode: string;
		courseTitle: string;
		startedAt: number;
		status: AttendanceStatus;
		method: string;
		recordedBy: string | null;
		flagged: boolean;
		flagReason: string | null;
		disputed: boolean;
		disputeNote: string | null;
		disputeResolvedBy: string | null;
		overriddenBy: string | null;
		prevStatus: AttendanceStatus | null;
	}

	const OVERRIDABLE: AttendanceStatus[] = ['Present', 'Late', 'Out_of_Range', 'Absent', 'Excused'];

	/**
	 * bits-ui refuses an empty (or undefined) value on a select item, so the
	 * "Change status…" row travels through the menu as a sentinel and is mapped
	 * back to nothing-chosen at both edges.
	 */
	const NO_STATUS = 'no-status';

	/**
	 * The lecturer's view of one student: totals per course, then their
	 * individual records with override and remove. Only the lecturer can change
	 * settled records — every change is stamped on the record.
	 */
	let {
		personId,
		fullName,
		token,
		open = $bindable(false),
		onchanged
	}: {
		personId: string | null;
		fullName: string;
		token: string;
		open?: boolean;
		onchanged?: () => void | Promise<void>;
	} = $props();

	let buckets = $state<CourseBucket[]>([]);
	let records = $state<RecordRow[]>([]);
	let loading = $state(false);
	let busyId = $state('');
	let draft = $state<Record<string, AttendanceStatus | undefined>>({});

	$effect(() => {
		if (open && personId) void load();
	});

	async function load() {
		if (!personId) return;
		loading = true;
		try {
			const client = requireConvexClient();
			const [report, recs] = (await Promise.all([
				client.query(api.reports.personReport, { token, personId: personId as never }),
				client.query(api.reports.personRecords, { token, personId: personId as never })
			])) as [{ rows: CourseBucket[] }, RecordRow[]];
			buckets = report.rows;
			records = recs;
			draft = {};
		} catch (err) {
			reportError(err, 'Could not load the records.');
		} finally {
			loading = false;
		}
	}

	async function override(r: RecordRow, status: AttendanceStatus) {
		busyId = r._id;
		try {
			const client = requireConvexClient();
			await client.mutation(api.attendance.override, {
				token,
				attendanceId: r._id as never,
				status
			});
			await load();
			await onchanged?.();
		} catch (err) {
			reportError(err, 'Could not change the record.');
		} finally {
			busyId = '';
		}
	}

	async function resolveDispute(r: RecordRow) {
		busyId = r._id;
		try {
			const client = requireConvexClient();
			await client.mutation(api.attendance.resolveDispute, { token, attendanceId: r._id as never });
			await load();
			await onchanged?.();
		} catch (err) {
			reportError(err, 'Could not resolve the dispute.');
		} finally {
			busyId = '';
		}
	}

	async function removeRecord(r: RecordRow) {
		if (!confirm(`Delete the ${r.courseCode} record for ${fullName}? This cannot be undone.`)) return;
		busyId = r._id;
		try {
			const client = requireConvexClient();
			await client.mutation(api.attendance.removeRecord, { token, attendanceId: r._id as never });
			await load();
			await onchanged?.();
		} catch (err) {
			reportError(err, 'Could not remove the record.');
		} finally {
			busyId = '';
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{fullName}</Dialog.Title>
			<Dialog.Description>
				Totals across every course, then each individual record. Override only what you have checked.
			</Dialog.Description>
		</Dialog.Header>

		{#if loading}
			<div class="h-32 animate-pulse rounded-md bg-muted"></div>
		{:else}
			<div class="overflow-x-auto rounded-md border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Course</Table.Head>
							<Table.Head>Lectures</Table.Head>
							<Table.Head>Present</Table.Head>
							<Table.Head>Late</Table.Head>
							<Table.Head>Absent</Table.Head>
							<Table.Head>Attendance</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each buckets as b (b.courseId)}
							<Table.Row>
								<Table.Cell class="font-medium">{b.courseCode}</Table.Cell>
								<Table.Cell>{b.lectures}</Table.Cell>
								<Table.Cell>{b.present}</Table.Cell>
								<Table.Cell>{b.late}</Table.Cell>
								<Table.Cell>{b.absent}</Table.Cell>
								<Table.Cell class="font-semibold {b.attendPct < 75 ? 'text-amber-700' : 'text-emerald-700'}">
									{b.attendPct}%
								</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={6} class="text-center text-muted-foreground">
									No attendance recorded yet.
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			<div class="flex flex-col gap-2">
				<p class="text-sm font-medium">Recent records</p>
				<ul class="flex flex-col divide-y divide-border rounded-md border">
					{#each records as r (r._id)}
						<li class="flex flex-col gap-2 p-3 text-sm">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span>
									<strong>{r.courseCode}</strong>
									<span class="text-xs text-muted-foreground">
										· {formatDateTime(r.startedAt)}
										{#if r.recordedBy}· via {r.recordedBy}{/if}
										{#if r.overriddenBy}· changed by {r.overriddenBy}{/if}
									</span>
								</span>
								<span class="flex items-center gap-2">
									{#if r.flagged}
										<Badge class="bg-amber-600 text-white"><Flag class="size-3" aria-hidden="true" /> Flagged</Badge>
									{/if}
									{#if r.disputed}
										<Badge class="bg-red-600 text-white"><TriangleAlert class="size-3" aria-hidden="true" /> Disputed</Badge>
									{/if}
									<StatusBadge status={r.status} />
								</span>
							</div>
							{#if r.flagReason || r.disputeNote}
								<p class="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
									{#if r.disputeNote}Student says: “{r.disputeNote}”{/if}
									{#if r.flagReason}{r.disputeNote ? ' — ' : ''}{r.flagReason}{/if}
									{#if !r.disputed && r.disputeResolvedBy}
										<span class="block">Reviewed by {r.disputeResolvedBy} — standing by this record.</span>
									{/if}
								</p>
							{/if}
							{#if r.disputed}
								<div>
									<Button
										variant="outline"
										size="sm"
										disabled={busyId === r._id}
										onclick={() => resolveDispute(r)}
									>
										Mark reviewed — record stands
									</Button>
								</div>
							{/if}
							<div class="flex flex-wrap items-center gap-2">
								<Select.Root
									type="single"
									value={draft[r._id] ?? NO_STATUS}
									onValueChange={(v) => {
										draft[r._id] = v === NO_STATUS ? undefined : (v as AttendanceStatus);
									}}
								>
									<Select.Trigger
										size="sm"
										aria-label={`Change record for ${r.courseCode}`}
									>
										<Select.Value placeholder="Change status…" />
									</Select.Trigger>
									<Select.Content>
										<Select.Group>
											<Select.Item value={NO_STATUS}>Change status…</Select.Item>
											{#each OVERRIDABLE as s (s)}
												<Select.Item value={s}>{s.replace('_', ' ')}</Select.Item>
											{/each}
										</Select.Group>
									</Select.Content>
								</Select.Root>
								<Button
									variant="outline"
									size="sm"
									disabled={!draft[r._id] || busyId === r._id}
									onclick={() => {
										const status = draft[r._id];
										if (status) void override(r, status);
									}}
								>
									Apply
								</Button>
								<Button
									variant="ghost"
									size="sm"
									class="text-red-700"
									disabled={busyId === r._id}
									onclick={() => removeRecord(r)}
								>
									Delete
								</Button>
							</div>
						</li>
					{:else}
						<li class="p-4 text-center text-muted-foreground">No individual records.</li>
					{/each}
				</ul>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
