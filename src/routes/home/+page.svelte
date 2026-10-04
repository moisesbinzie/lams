<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { LogOut, QrCode, CalendarDays, BarChart3, ScanLine, Settings, Pencil } from '@lucide/svelte';
	import type { Me, MyEnrolment, MyAttendanceRow, RepClass } from '$lib/lams/types';

	let me = $state<Me | null>(null);
		// The template only ever renders the person branch, so narrow once here
		// rather than guarding every field access.
		const person = $derived(me && me.kind === 'person' ? me : null);
	let token = $state('');
	let loading = $state(true);
	let error = $state('');
	let editing = $state(false);
	let email = $state('');
	let phone = $state('');
	let fullName = $state('');
	let saving = $state(false);

	let enrolments = $state<MyEnrolment[]>([]);
	let repClasses = $state<RepClass[]>([]);
	let recent = $state<MyAttendanceRow[]>([]);
	let summary = $state<{ attendPct: number; totalLectures: number } | null>(null);

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
			const found = (await client.query(api.staff.me, { token })) as Me | null;
			if (!found) {
				// The token is genuinely expired or revoked: end the session
				// everywhere, navbar included.
				endSession();
				await goto('/signin');
				return;
			}
			// Lecturers have their own console; this page is for people.
			if (found.kind !== 'person') {
				await goto('/manage');
				return;
			}
			me = found;
			email = found.email;
			phone = found.phone;
			fullName = found.fullName;

			[enrolments, recent, summary] = await Promise.all([
				client.query(api.enrolments.listMine, { token }) as Promise<MyEnrolment[]>,
				client.query(api.attendance.myAttendance, { token }) as Promise<MyAttendanceRow[]>,
				client.query(api.reports.mySummary, { token }) as Promise<{ attendPct: number; totalLectures: number }>
			]);
			if (found.role !== 'student') {
				repClasses = (await client.query(api.reps.listForPerson, { token })) as unknown as RepClass[];
			}
		} catch (err) {
			// Keep the token: a failed load is usually a network blip, and
			// wiping the session here used to sign people out mid-use.
			error = err instanceof Error ? err.message : 'Could not load your account.';
		} finally {
			loading = false;
		}
	}

	async function saveDetails(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		error = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.people.updateMyName, { token, fullName: fullName.trim() });
			await client.mutation(api.people.updateMyDetails, { token, email, phone });
			editing = false;
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not save your details.';
		} finally {
			saving = false;
		}
	}

	function signOut() {
		endSession();
		void goto('/signin');
	}
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4">
	{#if loading}
		<Card.Root aria-busy="true">
			<Card.Content class="flex flex-col gap-3 pt-6">
				<div class="h-6 w-1/2 animate-pulse rounded-md bg-muted"></div>
				<p class="text-sm text-muted-foreground">Loading your account…</p>
			</Card.Content>
		</Card.Root>
	{:else if person}
		<Card.Root>
			<Card.Content class="flex flex-wrap items-start justify-between gap-4 pt-6">
				<div>
					<h1 class="text-2xl font-bold text-lams-navy">{person.fullName}</h1>
					<p class="text-sm text-muted-foreground">
						{person.regNumber}
						{#if person.classNames.length > 0}
							· {person.classNames.join(', ')}
						{/if}
					</p>
					<p class="mt-1 text-xs text-muted-foreground">
						{#if person.role === 'rep'}
							Class representative — you can take attendance for your subjects.
						{:else}
							Student
						{/if}
					</p>
				</div>
				<div class="flex gap-2">
					<Button variant="outline" size="sm" onclick={() => (editing = !editing)}>
						<Pencil class="size-3.5" /> {editing ? 'Close' : 'Edit my details'}
					</Button>
					<Button variant="ghost" size="sm" onclick={signOut}>
						<LogOut class="size-3.5" /> Sign out
					</Button>
				</div>
			</Card.Content>
		</Card.Root>

		{#if error}
			<p class="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800" role="alert">{error}</p>
		{/if}

		{#if editing}
			<Card.Root>
				<Card.Header>
					<Card.Title>Your details</Card.Title>
					<Card.Description>
						You can change your name and how we reach you. Your registration number and student ID are
						fixed — ask your class rep or lecturer to change those.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<form class="grid gap-3 sm:grid-cols-3" onsubmit={saveDetails}>
						<div class="flex flex-col gap-1.5">
							<Label for="fn">Full name</Label>
							<Input id="fn" bind:value={fullName} required />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="em">Email</Label>
							<Input id="em" type="email" bind:value={email} />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="ph">Phone</Label>
							<Input id="ph" bind:value={phone} />
						</div>
						<div class="sm:col-span-3">
							<p class="mb-2 text-xs text-muted-foreground">
								Registration number <strong>{person.regNumber}</strong> · Student ID
								<strong>{person.studentId}</strong> — locked
							</p>
							<Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
						</div>
					</form>
				</Card.Content>
			</Card.Root>
		{/if}

		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			<Button href="/code" size="lg" class="h-auto flex-col items-start gap-1 py-4 text-left">
				<QrCode class="size-5" />
				<span class="text-sm font-semibold">My attendance code</span>
				<span class="text-xs font-normal opacity-80">Show this to be scanned</span>
			</Button>
			<Button href="/timetable" size="lg" variant="outline" class="h-auto flex-col items-start gap-1 py-4 text-left">
				<CalendarDays class="size-5" />
				<span class="text-sm font-semibold">My timetable</span>
				<span class="text-xs font-normal opacity-80">When my classes meet</span>
			</Button>
			<Button href="/attendance" size="lg" variant="outline" class="h-auto flex-col items-start gap-1 py-4 text-left">
				<BarChart3 class="size-5" />
				<span class="text-sm font-semibold">My attendance</span>
				<span class="text-xs font-normal opacity-80">See and report errors</span>
			</Button>
			{#if person.role !== 'student'}
				<Button href="/scan" size="lg" variant="secondary" class="h-auto flex-col items-start gap-1 py-4 text-left">
					<ScanLine class="size-5" />
					<span class="text-sm font-semibold">Take attendance</span>
					<span class="text-xs font-normal opacity-80">Scan students in</span>
				</Button>
			{:else}
				<Button href="/courses" size="lg" variant="secondary" class="h-auto flex-col items-start gap-1 py-4 text-left">
					<Settings class="size-5" />
					<span class="text-sm font-semibold">My subjects</span>
					<span class="text-xs font-normal opacity-80">Join or leave a subject</span>
				</Button>
			{/if}
		</div>

		{#if summary && summary.totalLectures > 0}
			<Card.Root>
				<Card.Content class="flex items-center justify-around gap-4 pt-6 text-center">
					<div>
						<p class="text-3xl font-bold text-emerald-700">{summary.attendPct}%</p>
						<p class="text-xs text-muted-foreground">Overall attendance</p>
					</div>
					<div>
						<p class="text-3xl font-bold">{summary.totalLectures}</p>
						<p class="text-xs text-muted-foreground">Lectures recorded</p>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if person.role !== 'student'}
			<Card.Root>
				<Card.Header>
					<Card.Title>Classes you can take attendance for</Card.Title>
				</Card.Header>
				<Card.Content>
					{#if repClasses.length === 0}
						<p class="text-sm text-muted-foreground">
							You have not been made a class rep yet. Your lecturer sets this up.
						</p>
					{:else}
						<ul class="flex flex-wrap gap-2">
							{#each repClasses as c (c.classId)}
								<li class="rounded-full border border-border px-3 py-1 text-sm">{c.className}</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}

		{#if recent.length > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title>Recently recorded</Card.Title>
				</Card.Header>
				<Card.Content>
					<ul class="flex flex-col gap-1 text-sm">
						{#each recent.slice(0, 5) as r (r._id)}
							<li class="flex items-center justify-between gap-2">
								<span class="text-muted-foreground">
									{r.subjectCode} · {new Date(r.date).toLocaleDateString()}
								</span>
								<span class="font-medium">{r.status.replace('_', ' ')}</span>
							</li>
						{/each}
					</ul>
					<Button variant="outline" size="sm" class="mt-3" href="/attendance">See everything</Button>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>