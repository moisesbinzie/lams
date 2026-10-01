<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { getAdminPassword } from '$lib/lams/admin';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import AdminGate from '$lib/components/lams/admin-gate.svelte';
	import RosterManager from './RosterManager.svelte';
	import SessionManager from './SessionManager.svelte';
	import AttendanceList from './AttendanceList.svelte';
	import ReportsPanel from './ReportsPanel.svelte';
	import { CalendarDays, ClipboardList, GraduationCap, Plus, Settings, Users } from '@lucide/svelte';
	import type { CourseDoc, TermDoc } from '$lib/lams/types';

	let password = $state(getAdminPassword());
	let terms = $state<TermDoc[]>([]);
	let courses = $state<CourseDoc[]>([]);
	let termId = $state('');
	let courseId = $state('');
	let sessionId = $state('');
	let error = $state('');
	let note = $state('');
	let loading = $state(false);

	let termName = $state('');
	let termStart = $state('');
	let termEnd = $state('');
	let courseCode = $state('');
	let courseTitle = $state('');
	let oldPw = $state('');
	let newPw = $state('');
	let pwMsg = $state('');

	const currentTerm = $derived(terms.find((t) => t._id === termId) ?? null);
	const currentCourse = $derived(courses.find((c) => c._id === courseId) ?? null);

	async function loadAll() {
		if (!password) return;
		error = '';
		loading = true;
		try {
			const client = requireConvexClient();
			const freshTerms = (await client.query(api.terms.list, {})) as unknown as TermDoc[];
			terms = freshTerms;
			// Auto-select the newest term so courses are never hidden behind an empty filter.
			if (!termId && freshTerms.length > 0) termId = freshTerms[0]._id;
			const freshCourses = (await client.query(
				api.courses.list,
				termId ? { termId: termId as never } : {}
			)) as unknown as CourseDoc[];
			courses = freshCourses;
			if (courseId && !freshCourses.some((c) => c._id === courseId)) {
				courseId = '';
				sessionId = '';
			}
			if (!courseId && freshCourses.length > 0) courseId = freshCourses[0]._id;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Load failed.';
		} finally {
			loading = false;
		}
	}

	async function selectTerm(value: string) {
		termId = value;
		courseId = '';
		sessionId = '';
		await loadAll();
	}

	function selectCourse(value: string) {
		courseId = value;
		sessionId = '';
	}

	async function createTerm(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		note = '';
		try {
			const client = requireConvexClient();
			const id = (await client.mutation(api.terms.create, {
				password,
				name: termName,
				startDate: termStart,
				endDate: termEnd
			})) as unknown as string;
			termName = '';
			termStart = '';
			termEnd = '';
			termId = id;
			courseId = '';
			await loadAll();
			note = 'Term created — now add a course inside it.';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Create term failed.';
		}
	}

	async function removeTerm(id: string) {
		if (!confirm('Delete this term? Terms with courses cannot be deleted.')) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.terms.remove, { password, id: id as never });
			if (termId === id) {
				termId = '';
				courseId = '';
				sessionId = '';
			}
			await loadAll();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Delete term failed.';
		}
	}

	async function createCourse(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		note = '';
		try {
			const client = requireConvexClient();
			const id = (await client.mutation(api.courses.create, {
				password,
				...(termId ? { termId: termId as never } : {}),
				code: courseCode,
				title: courseTitle
			})) as unknown as string;
			courseCode = '';
			courseTitle = '';
			courseId = id;
			await loadAll();
			note = 'Course created — import the roster next (Step 3).';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Create course failed.';
		}
	}

	async function removeCourse(id: string) {
		if (!confirm('Delete this course, its roster, sessions and attendance records?')) return;
		try {
			const client = requireConvexClient();
			await client.mutation(api.courses.remove, { password, id: id as never });
			if (courseId === id) {
				courseId = '';
				sessionId = '';
			}
			await loadAll();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Delete course failed.';
		}
	}

	async function changePassword(e: SubmitEvent) {
		e.preventDefault();
		pwMsg = '';
		try {
			const client = requireConvexClient();
			await client.mutation(api.settings.setPassword, { oldPassword: oldPw, newPassword: newPw });
			pwMsg = 'Password updated — use the new one next time you unlock.';
			oldPw = '';
			newPw = '';
		} catch (err) {
			pwMsg = err instanceof Error ? err.message : 'Change failed.';
		}
	}

	function handleUnlock(pw: string) {
		password = pw;
		if (pw) {
			void loadAll();
		} else {
			terms = [];
			courses = [];
			termId = '';
			courseId = '';
			sessionId = '';
		}
	}

	onMount(() => {
		if (password) void loadAll();
	});
</script>


<div class="flex flex-col gap-4">
	<div class="flex items-center gap-3">
		<img src="/lams-logo.png" alt="LAMS" class="size-12 rounded-lg" />
		<div>
			<h1 class="text-xl font-bold text-lams-navy">Lecturer console</h1>
			<p class="text-xs text-muted-foreground">
				Unlock, pick a term and course, load the roster, open a session with its QR, watch attendance arrive,
				then export the report.
			</p>
		</div>
	</div>

	<AdminGate
		title="Step 1 — Unlock lecturer tools"
		description="One shared admin password protects every lecturer action and class-rep batch."
		onUnlock={handleUnlock}
	/>

	{#if error}
		<Card.Root class="border-red-200">
			<Card.Content class="pt-6 text-sm text-red-700" role="alert">{error}</Card.Content>
		</Card.Root>
	{/if}
	{#if note}
		<Card.Root class="border-emerald-200">
			<Card.Content class="pt-6 text-sm text-emerald-800">{note}</Card.Content>
		</Card.Root>
	{/if}

	{#if password}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<CalendarDays class="size-5 text-lams-navy" /> Step 2 — Term &amp; course
				</Card.Title>
				<Card.Description>
					Everything below is scoped to the selected course. Terms group courses per academic period.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<div class="grid gap-3 md:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<Label for="termSelect">Active term</Label>
						<Select.Root type="single" value={termId} onValueChange={(v) => v && selectTerm(v)}>
							<Select.Trigger id="termSelect" class="w-full">
								<Select.Value placeholder={terms.length ? 'Select a term' : 'No terms yet'} />
							</Select.Trigger>
							<Select.Content>
								{#each terms as t (t._id)}
									<Select.Item value={t._id}>{t.name} ({t.startDate} → {t.endDate})</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="courseSelect">Course</Label>
						<Select.Root
							type="single"
							value={courseId}
							onValueChange={(v) => v && selectCourse(v)}
							disabled={courses.length === 0}
						>
							<Select.Trigger id="courseSelect" class="w-full">
								<Select.Value placeholder={courses.length ? 'Select a course' : 'No courses in this term'} />
							</Select.Trigger>
							<Select.Content>
								{#each courses as c (c._id)}
									<Select.Item value={c._id}>{c.code} — {c.title}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>

				<p class="rounded-md border border-border bg-muted/50 p-2 text-xs text-muted-foreground">
					{#if currentCourse}
						Working on <strong>{currentCourse.code} — {currentCourse.title}</strong>{#if currentTerm}
							, {currentTerm.name}{/if}. Roster, sessions, attendance and reports all apply to this course.
					{:else}
						No course selected — add a term and a course to unlock the roster, sessions and reports.
					{/if}
					{#if loading}<span class="ml-1">Loading…</span>{/if}
				</p>

				<div class="grid gap-3 md:grid-cols-2">
					<details class="rounded-md border border-border p-3" open={terms.length === 0}>
						<summary class="cursor-pointer text-sm font-medium">Add a term</summary>
						<form class="mt-3 flex flex-col gap-2" onsubmit={createTerm}>
							<Input bind:value={termName} placeholder="e.g. Semester 1 2026" required />
							<DatePicker bind:value={termStart} label="Start date" id="termStart" />
							<DatePicker bind:value={termEnd} label="End date" id="termEnd" />
							<Button type="submit" size="sm" disabled={!termStart || !termEnd}>
								<Plus class="size-4" /> Add term
							</Button>
						</form>
						{#if currentTerm}
							<div class="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
								<span class="text-muted-foreground">Selected: {currentTerm.name}</span>
								<Button variant="ghost" size="sm" onclick={() => removeTerm(currentTerm._id)}>Delete</Button>
							</div>
						{/if}
					</details>

					<details class="rounded-md border border-border p-3" open={terms.length > 0 && courses.length === 0}>
						<summary class="cursor-pointer text-sm font-medium">Add a course</summary>
						<form class="mt-3 flex flex-col gap-2" onsubmit={createCourse}>
							<Input bind:value={courseCode} placeholder="Course code, e.g. BIT 221" required />
							<Input bind:value={courseTitle} placeholder="Course title, e.g. Database Systems" required />
							<Button type="submit" size="sm" disabled={!termId}>
								<Plus class="size-4" /> Add course
							</Button>
						</form>
						{#if currentCourse}
							<div class="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
								<span class="text-muted-foreground">Selected: {currentCourse.code}</span>
								<Button variant="ghost" size="sm" onclick={() => removeCourse(currentCourse._id)}>
									Delete
								</Button>
							</div>
						{/if}
					</details>
				</div>
			</Card.Content>
		</Card.Root>

		{#if currentCourse}
			<RosterManager {password} courseId={currentCourse._id} />
			<SessionManager {password} courseId={currentCourse._id} onSelect={(id) => (sessionId = id)} />
		{:else}
			<Card.Root>
				<Card.Content class="pt-6 text-center text-sm text-muted-foreground">
					<GraduationCap class="mx-auto mb-2 size-8 text-muted-foreground/60" />
					Pick or create a course above to unlock the roster, sessions, attendance and reports.
				</Card.Content>
			</Card.Root>
		{/if}

		{#if sessionId}
			<AttendanceList {password} {sessionId} />
		{/if}
		{#if currentCourse}
			<ReportsPanel {password} courseId={currentCourse._id} />
		{/if}

		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<Settings class="size-5 text-lams-navy" /> Step 7 — Settings &amp; records
				</Card.Title>
				<Card.Description>
					Default admin password is <code>admin123</code> — change it before real classes. The shared
					<a href="/records" class="underline">Records review</a> page re-checks attendance across past
					sessions with its own CSV export.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form class="grid gap-2 md:grid-cols-3" onsubmit={changePassword}>
					<div class="flex flex-col gap-1.5">
						<Label for="oldPw">Old password</Label>
						<Input id="oldPw" type="password" bind:value={oldPw} required />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="newPw">New password (min 6 chars)</Label>
						<Input id="newPw" type="password" bind:value={newPw} minlength={6} required />
					</div>
					<div class="flex items-end">
						<Button type="submit" size="sm">Update password</Button>
					</div>
				</form>
				{#if pwMsg}<p class="mt-2 text-sm text-muted-foreground">{pwMsg}</p>{/if}
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root>
			<Card.Content class="flex flex-col items-center gap-3 py-8 text-center">
				<ClipboardList class="size-9 text-muted-foreground/60" />
				<p class="text-sm font-medium">Lecturer tools are locked.</p>
				<p class="max-w-md text-sm text-muted-foreground">
					Unlock with the shared admin password to add terms, courses and rosters, open a session with its
					QR code, watch attendance arrive live and export reports. Students never need a password — they
					only scan.
				</p>
			</Card.Content>
		</Card.Root>
	{/if}
</div>

