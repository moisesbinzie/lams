<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { ensureSession, sessionMe, sessionStatus } from '$lib/lams/session.svelte';
	import { ScanLine, BookOpen, ClipboardCheck, ArrowRight } from '@lucide/svelte';

	/**
	 * Landing page, kept deliberately small: one promise, three steps, one
	 * action. Everything procedural lives in the How to Use guide.
	 */
	const steps = [
		{ icon: ClipboardCheck, text: 'Join your programme — once, with help from your representative.' },
		{ icon: BookOpen, text: 'Pick your courses for the semester.' },
		{ icon: ScanLine, text: 'Scan the screen in the hall. Done.' }
	];

	const viewer = $derived(sessionMe());
	const isAuthed = $derived(sessionStatus() === 'authed' && !!viewer);
	const isStaff = $derived(viewer?.kind === 'staff');
	const isAdmin = $derived(
		viewer?.kind === 'staff' && ((viewer as { isAdmin?: boolean }).isAdmin === true || viewer.role === 'admin')
	);
	const dashboardHref = $derived(
		!viewer ? '/signin' : viewer.kind === 'person' ? '/home' : isAdmin ? '/admin' : '/manage'
	);
	const dashboardLabel = $derived(
		!viewer ? 'Sign in' : isAdmin ? 'Open admin console' : isStaff ? 'Open lecturer console' : 'Go to my account'
	);
	const signedInAs = $derived.by(() => {
		if (!isAuthed || !viewer) return '';
		if (viewer.kind === 'staff') return `${viewer.username} (${isAdmin ? 'admin' : 'lecturer'})`;
		return viewer.fullName;
	});

	onMount(() => {
		void ensureSession();
	});
</script>

<div class="mx-auto flex w-full max-w-2xl flex-col items-center gap-10 py-10 text-center">
	<section class="flex flex-col items-center gap-6">
		<div class="grid w-full items-center gap-6 text-center md:grid-cols-[1.2fr_1fr] md:text-left">
			<div class="flex flex-col items-center gap-4 md:items-start">
				<h1 class="text-4xl font-extrabold tracking-tight text-lams-navy sm:text-5xl">
					Attendance in seconds, not minutes.
				</h1>
				<p class="max-w-md text-lg text-muted-foreground">
					Scan the code on the screen. Your attendance is recorded — no queues, no lists.
				</p>
			</div>
			<img
				src="/lams-logo.png"
				alt="LAMS — Lecture Attendance Monitoring System"
				class="size-40 justify-self-center rounded-3xl shadow-sm sm:size-56 md:size-72 md:justify-self-end"
			/>
		</div>
		<div class="flex w-full max-w-sm flex-col gap-2 sm:w-auto sm:min-w-72">
			<Button href={dashboardHref} size="lg" class="w-full text-base">
				{dashboardLabel}
				<ArrowRight class="size-4" />
			</Button>
			{#if !isAuthed}
				<Button href="/how-it-works" variant="outline" size="lg" class="w-full text-base">
					How to use LAMS
				</Button>
			{/if}
		</div>
		{#if isAuthed && signedInAs}
			<p class="text-xs text-muted-foreground">Signed in as {signedInAs}.</p>
		{/if}
	</section>

	<ol class="flex w-full flex-col gap-2 text-left">
		{#each steps as step, i (step.text)}
			<li class="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4">
				<span
					class="flex size-9 shrink-0 items-center justify-center rounded-full bg-lams-navy text-sm font-bold text-white"
					aria-hidden="true"
				>
					{i + 1}
				</span>
				<span class="flex min-w-0 items-center gap-2 text-[15px] font-medium">
					<step.icon class="size-5 shrink-0 text-lams-navy" aria-hidden="true" />
					{step.text}
				</span>
			</li>
		{/each}
	</ol>

	<Button variant="ghost" href="/how-it-works" class="text-muted-foreground">
		New here? Read the guide first <ArrowRight class="size-4" />
	</Button>
</div>
