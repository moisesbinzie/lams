<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { TriangleAlert } from '@lucide/svelte';
	import type { MyEnrolment } from '$lib/lams/types';

	interface OpenSubject {
		_id: string;
		subjectId: string;
		subjectCode: string;
		subjectTitle: string;
		hoursPerWeek: number | null;
		semesterName: string;
		className: string;
		alreadyEnrolled: boolean;
	}

	let token = $state('');
	let mine = $state<MyEnrolment[]>([]);
	let open = $state<OpenSubject[]>([]);
	let loading = $state(true);
	let busy = $state('');
	let error = $state('');
	let message = $state('');

	onMount(() => {
		token = getToken();
		if (!token) {
			void goto('/signin');
			return;
		}
		void load();
	});

	async function load() {
		try {
			const client = requireConvexClient();
			[mine, open] = await Promise.all([
				client.query(api.enrolments.listMine, { token }) as Promise<MyEnrolment[]>,
				client.query(api.enrolments.listOpenForStudent, { token }) as Promise<OpenSubject[]>
			]);
			error = '';
		} catch (err) {
			// Keep the token: a failed load is usually a network blip.
			error = err instanceof Error ? err.message : 'Could not load your subjects.';
		} finally {
			loading = false;
		}
	}

	async function join(offeringId: string) {
		busy = offeringId;
		error = '';
		message = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.enrolments.enrolSelf, { token, offeringId: offeringId as never });
			message = 'You have joined that subject.';
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not join that subject.';
		} finally {
			busy = '';
		}
	}

	async function leave(offeringId: string) {
		if (!confirm('Leave this subject? You can join again later while enrolment is open.')) return;
		busy = offeringId;
		error = '';
		message = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.enrolments.dropSelf, { token, offeringId: offeringId as never });
			message = 'You have left that subject.';
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not leave that subject.';
		} finally {
			busy = '';
		}
	}
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4">
	<div class="text-center">
		<h1 class="text-2xl font-bold text-lams-navy">My subjects</h1>
		<p class="text-sm text-muted-foreground">
			Join the subjects you are taking. Your class rep or lecturer can also add you.
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
	{#if message}
		<p class="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900" role="status">
			{message}
		</p>
	{/if}

	{#if loading}
		<Card.Root aria-busy="true">
			<Card.Content class="pt-6"><p class="text-sm text-muted-foreground">Loading…</p></Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Header>
				<Card.Title>Subjects you are taking ({mine.length})</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if mine.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						You are not enrolled in anything yet. Join a subject below, or ask your class rep to add you.
					</p>
				{:else}
					<ul class="flex flex-col divide-y divide-border">
						{#each mine as e (e._id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-3">
								<div>
									<p class="text-sm font-semibold">{e.subjectCode} — {e.subjectTitle}</p>
									<p class="text-xs text-muted-foreground">
										{e.semesterName}
										{#if e.meetings.length > 0}
											· meets {e.meetings.map((m) => (m.kind === 'weekly' ? m.startTime : m.date)).join(', ')}
										{/if}
										· added by {e.addedBy === 'self' ? 'you' : e.addedBy === 'rep' ? 'your class rep' : 'your lecturer'}
									</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									disabled={busy === e.offeringId}
									onclick={() => leave(e.offeringId)}
								>
									Leave
								</Button>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Available to join</Card.Title>
				<Card.Description>
					Your lecturer opens a subject for self-enrolment. If something is missing, ask them.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if open.length === 0}
					<p class="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
						No subjects are open for self-enrolment right now.
					</p>
				{:else}
					<ul class="flex flex-col divide-y divide-border">
						{#each open.filter((o) => !o.alreadyEnrolled) as o (o._id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-3">
								<div>
									<p class="text-sm font-semibold">{o.subjectCode} — {o.subjectTitle}</p>
									<p class="text-xs text-muted-foreground">
										{o.className} · {o.semesterName}
										{#if o.hoursPerWeek}· {o.hoursPerWeek} hours a week{/if}
									</p>
								</div>
								<Button size="sm" disabled={busy === o._id} onclick={() => join(o._id)}>Join</Button>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>