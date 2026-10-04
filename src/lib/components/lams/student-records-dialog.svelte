<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { formatDateTime } from '$lib/lams/time';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import { Flag, TriangleAlert } from '@lucide/svelte';
	import type { AttendanceStatus } from '$lib/lams/types';

	interface SubjectBucket {
		subjectId: string;
		subjectCode: string;
		subjectTitle: string;
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
		subjectCode: string;
		subjectTitle: string;
		startedAt: number;
		status: AttendanceStatus;
		method: string;
		recordedBy: string | null;
		flagged: boolean;
		flagReason: string | null;
		disputed: boolean;
		disputeNote: string | null;
		overriddenBy: string | null;
		prevStatus: AttendanceStatus | null;
	}

	const OVERRIDABLE: AttendanceStatus[] = ['Present', 'Late', 'Out_of_Range', 'Absent', 'Excused'];

	/**
	 * The lecturer's view of one student: totals per subject, then their
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

	let buckets = $state<SubjectBucket[]>([]);
	let records = $state<RecordRow[]>([]);
	let loading = $state(false);
	let error = $state('');
	let busyId = $state('');
	let draft = $state<Record<string, AttendanceStatus | undefined>>({});

	$effect(() => {
		if (open && personId) void load();
	});

	async function load() {
		if (!personId) return;
		loading = true;
		error = '';
		try {
			const client = requireConvexClient();
			const [report, recs] = (await Promise.all([
				client.query(api.reports.personReport, { token, personId: personId as never }),
				client.query(api.reports.personRecords, { token, personId: personId as never })
			])) as [{ rows: SubjectBucket[] }, RecordRow[]];
			buckets = report.rows;
			records = recs;
			draft = {};
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not load the records.';
		} finally {
			loading = false;
		}
	}

	async function override(r: RecordRow, status: AttendanceStatus) {
		busyId = r._id;
		error = '';
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
			error = err instanceof Error ? err.message : 'Could not change the record.';
		} finally {
			busyId = '';
		}
	}

	async function removeRecord(r: RecordRow) {
		if (!confirm(`Delete the ${r.subjectCode} record for ${fullName}? This cannot be undone.`)) return;
		busyId = r._id;
		error = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.attendance.removeRecord, { token, attendanceId: r._id as never });
			await load();
			await onchanged?.();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not remove the record.';
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
				Totals across every subject, then each individual record. Override only what you have checked.
			</Dialog.Description>
		</Dialog.Header>

		{#if error}
			<p class="text-sm text-red-700" role="alert">{error}</p>
		{/if}

		{#if loading}
			<div class="h-32 animate-pulse rounded-md bg-muted"></div>
		{:else}
			<div class="overflow-x-auto rounded-md border">
				<table class="w-full text-sm">
					<thead class="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
						<tr>
							<th class="px-2 py-1.5 font-medium">Subject</th>
							<th class="px-2 py-1.5 font-medium">Lectures</th>
							<th class="px-2 py-1.5 font-medium">Present</th>
							<th class="px-2 py-1.5 font-medium">Late</th>
							<th class="px-2 py-1.5 font-medium">Absent</th>
							<th class="px-2 py-1.5 font-medium">Attendance</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each buckets as b (b.subjectId)}
							<tr>
								<td class="px-2 py-1.5 font-medium">{b.subjectCode}</td>
								<td class="px-2 py-1.5">{b.lectures}</td>
								<td class="px-2 py-1.5">{b.present}</td>
								<td class="px-2 py-1.5">{b.late}</td>
								<td class="px-2 py-1.5">{b.absent}</td>
								<td class="px-2 py-1.5 font-semibold {b.attendPct < 75 ? 'text-amber-700' : 'text-emerald-700'}">
									{b.attendPct}%
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="6" class="px-2 py-4 text-center text-muted-foreground">
									No attendance recorded yet.
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="flex flex-col gap-2">
				<p class="text-sm font-medium">Recent records</p>
				<ul class="flex flex-col divide-y divide-border rounded-md border">
					{#each records as r (r._id)}
						<li class="flex flex-col gap-2 p-3 text-sm">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span>
									<strong>{r.subjectCode}</strong>
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
								</p>
							{/if}
							<div class="flex flex-wrap items-center gap-2">
								<select
									class="rounded-md border border-input bg-background p-1.5 text-xs"
									aria-label={`Change record for ${r.subjectCode}`}
									bind:value={draft[r._id]}
								>
									<option value={undefined}>Change status…</option>
									{#each OVERRIDABLE as s (s)}
										<option value={s}>{s.replace('_', ' ')}</option>
									{/each}
								</select>
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
