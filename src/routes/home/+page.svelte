<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { endSession } from '$lib/lams/session.svelte';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { LogOut, CalendarDays, BarChart3, ScanLine, BookOpen, Pencil } from '@lucide/svelte';
	import type { Me, MyEnrolment, MyAttendanceRow, ProgramRep } from '$lib/lams/types';
	import { reportError } from '$lib/lams/notify.svelte';
	import StudentNav from '$lib/components/lams/student-nav.svelte';

	let me = $state<Me | null>(null);
		// The template only ever renders the person branch, so narrow once here
		// rather than guarding every field access.
		const person = $derived(me && me.kind === 'person' ? me : null);
	let token = $state('');
	let loading = $state(true);
	let editing = $state(false);
	let email = $state('');
	let phone = $state('');
	let fullName = $state('');
	let saving = $state(false);

	let enrolments = $state<MyEnrolment[]>([]);
	let repPrograms = $state<ProgramRep[]>([]);
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
			// Staff have their own consoles; this page is for students and reps.
			if (found.kind !== 'person') {
				const staffIsAdmin =
					(found as { isAdmin?: boolean }).isAdmin === true || found.role === 'admin';
				await goto(staffIsAdmin ? '/admin' : '/manage');
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
				repPrograms = (await client.query(api.reps.listForPerson, { token })) as unknown as ProgramRep[];
			}
		} catch (err) {
			// Keep the token: a failed load is usually a network blip, and
			// wiping the session here used to sign people out mid-use.
			reportError(err, 'Could not load your account.');
		} finally {
			loading = false;
		}
	}

	async function saveDetails(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.people.updateMyName, { token, fullName: fullName.trim() });
			await client.mutation(api.people.updateMyDetails, { token, email, phone });
			editing = false;
			await load();
		} catch (err) {
			reportError(err, 'Could not save your details.');
		} finally {
			saving = false;
		}
	}

	function signOut() {
		endSession();
		void goto('/signin');
	}
</script>

	<StudentNav />
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
					<h1 class="flex flex-wrap items-center gap-2 text-2xl font-bold text-lams-navy">
						{person.fullName}
						{#if person.role === 'rep'}
							<Badge class="bg-lams-green text-white">Program rep account</Badge>
						{:else}
							<Badge variant="secondary">Student account</Badge>
						{/if}
					</h1>
					<p class="text-sm text-muted-foreground">
						{person.regNumber}
						{#if person.programNames.length > 0}
							· {person.programNames.join(', ')}
						{/if}
					</p>
					<p class="mt-1 text-xs text-muted-foreground">
						{#if person.role === 'rep'}
							Program representative — you can take attendance for your courses.
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

		{#if editing}
			<Card.Root>
				<Card.Header>
					<Card.Title>Your details</Card.Title>
					<Card.Description>
						You can change your name and how we reach you. Your registration number and student ID are
						fixed — ask your program rep or lecturer to change those.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<form class="grid gap-4 sm:grid-cols-3" onsubmit={saveDetails}>
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

		<!--
			Scanning leads because it is the one thing a student opens this page
			to do in a lecture. "My courses" is no longer conditional: a program rep
			still needs to join and drop courses like anyone else.

			It is also the loudest thing on the page on purpose — a full row, a size
			up, and lifted off the surface with its own shadow. A student standing in
			a hall is looking for one target, not reading cards.

			Two columns, not three: the site column is 768 px, so a three-column
			state would only ever have applied at a viewport width the content never
			sees.
		-->
		<div class="grid gap-4 sm:grid-cols-2">
			<Button
				href="/scanner"
				size="lg"
				class="h-auto flex-col items-start gap-1 py-5 text-left shadow-lg shadow-primary/30 transition-shadow hover:shadow-xl sm:col-span-2 sm:flex-row sm:items-center sm:gap-3"
			>
				<ScanLine class="size-8 shrink-0" />
				<span class="flex flex-col">
					<span class="text-lg font-bold">Scan attendance</span>
					<span class="text-xs font-normal opacity-90">Point your phone at the screen in the hall</span>
				</span>
			</Button>
			<Button href="/timetable" size="lg" variant="outline" class="h-auto flex-col items-start gap-1 py-4 text-left">
				<CalendarDays class="size-5" />
				<span class="text-sm font-semibold">My timetable</span>
				<span class="text-xs font-normal opacity-80">When my courses meet</span>
			</Button>
			<Button href="/attendance" size="lg" variant="outline" class="h-auto flex-col items-start gap-1 py-4 text-left">
				<BarChart3 class="size-5" />
				<span class="text-sm font-semibold">My attendance</span>
				<span class="text-xs font-normal opacity-80">See and report errors</span>
			</Button>
			<Button href="/courses" size="lg" variant="outline" class="h-auto flex-col items-start gap-1 py-4 text-left">
				<BookOpen class="size-5" />
				<span class="text-sm font-semibold">My courses</span>
				<span class="text-xs font-normal opacity-80">Join or leave a course</span>
			</Button>
			{#if person.role !== 'student'}
				<Button href="/scan" size="lg" variant="secondary" class="h-auto flex-col items-start gap-1 py-4 text-left">
					<ScanLine class="size-5" />
					<span class="text-sm font-semibold">Take attendance</span>
					<span class="text-xs font-normal opacity-80">Put my station on screen</span>
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
					<Card.Title>Programs you can take attendance for</Card.Title>
				</Card.Header>
				<Card.Content>
					{#if repPrograms.length === 0}
						<p class="text-sm text-muted-foreground">
							You have not been made a program rep yet. Your lecturer sets this up.
						</p>
					{:else}
						<ul class="flex flex-wrap gap-2">
							{#each repPrograms as c (c.programId)}
								<li class="rounded-full border border-border px-3 py-1 text-sm">{c.programName}</li>
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
									{r.courseCode} · {new Date(r.date).toLocaleDateString()}
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