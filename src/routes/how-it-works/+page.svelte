<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';
	import { ensureSession, sessionMe, sessionStatus } from '$lib/lams/session.svelte';
	import {
		AlertTriangle,
		Ban,
		Camera,
		CheckCircle2,
		CircleCheck,
		ClipboardCheck,
		Clock,
		DoorOpen,
		GraduationCap,
		Hand,
		HelpCircle,
		MapPin,
		MinusCircle,
		MonitorSmartphone,
		ScanLine,
		ShieldCheck,
		Smartphone,
		XCircle
	} from '@lucide/svelte';

	/**
	 * Written for students, not for whoever specified the system.
	 *
	 * Nothing on this page needs a technical vocabulary to be understood: no
	 * secrets, tokens, hashes, gates or accuracy circles. If a sentence here
	 * would make a first-year stop reading to work out what it means, it is the
	 * wrong sentence. The reasoning behind the design lives in the code comments
	 * next to the code that enforces it.
	 */

	const steps = [
		{
			icon: Camera,
			title: 'Point your camera at the screen',
			body: 'The screen at the front of the hall shows a square barcode. Open your camera the way you normally photograph anything and hold it up to the square.'
		},
		{
			icon: Smartphone,
			title: 'Tap the link that appears',
			body: 'Your phone opens LAMS by itself. If you are already signed in, that is the last thing you do.'
		},
		{
			icon: MapPin,
			title: 'Say yes when asked for your location',
			body: 'Your phone asks once. Allowing it is what marks you present — without it, LAMS cannot tell whether you are in the hall.'
		}
	];

	/** One line each, in the student's own words rather than the system's. */
	const statuses = [
		{ icon: CircleCheck, label: 'Present', meaning: 'You were there, in time, inside the room.' },
		{ icon: Clock, label: 'Late', meaning: 'You were there, but after the lecture had started.' },
		{
			icon: MapPin,
			label: 'Out of range',
			meaning:
				'Your phone said you were too far from the screen. If that is wrong, tell your rep or lecturer and they can change it.'
		},
		{ icon: XCircle, label: 'Absent', meaning: 'Nothing was recorded for you before the lecture closed.' },
		{
			icon: MinusCircle,
			label: 'Excused',
			meaning: 'You were away and it was agreed. This does not count against you.'
		}
	];

	const problems = [
		{
			icon: MapPin,
			question: 'It said I was too far away, but I was in the room',
			answer:
				'Phones are not accurate indoors, especially in a hall full of people. Your rep sees this too and can correct it, and the change is kept on your record. Nothing disappears.'
		},
		{
			icon: Smartphone,
			question: 'My location will not turn on',
			answer:
				'Nothing is lost — a scan still goes through, marked for your lecturer to check. It also helps to turn location on for the browser you are scanning with, so the check works next time.'
		},
		{
			icon: Ban,
			question: 'I have no phone, or the camera will not focus',
			answer:
				'Your class rep can add you by hand. They have to say why, and their name goes on the record — that is normal and it is not held against you.'
		},
		{
			icon: AlertTriangle,
			question: 'The screen says it has been moved',
			answer:
				'The screen has been carried out of the room it belongs to, so it has stopped recording anything. Tell your class rep. Once it is put back, scanning starts again and you can scan in.'
		},
		{
			icon: Clock,
			question: 'The screen says the code has expired',
			answer:
				'The code changes every 10 seconds so a photo of the screen cannot be used later. Just scan the screen again — the page opens by itself.'
		},
		{
			icon: ShieldCheck,
			question: 'Something on my record looks wrong',
			answer:
				'Open My attendance and report it. Say what happened, and your rep or lecturer can put it right. The original value is always kept, so nobody can quietly edit your history.'
		}
	];

	const roles = [
		{
			icon: ScanLine,
			who: 'You, as a student',
			body: 'Scan the screen, allow your location. Then check your own attendance and report anything that looks wrong.'
		},
		{
			icon: Hand,
			who: 'Class rep',
			body: 'Start the lecture, put the screen at the front of the hall and leave it there. Add anyone without a working phone by hand, with a reason.'
		},
		{
			icon: GraduationCap,
			who: 'Lecturer',
			body: 'Set up subjects and classes, start lectures, and correct or excuse any record afterwards. Every change is logged.'
		}
	];

	const timeline = [
		{ at: 'Before', title: 'Your rep or lecturer opens the lecture', body: 'They set where the screen stands and how long you have to arrive.' },
		{ at: 'Start', title: 'The screen appears', body: 'A code is created for this lecture only, and the barcode goes live.' },
		{ at: 'Every 10s', title: 'The code changes', body: 'This is what stops a photo of the screen being used later.' },
		{ at: '0–10 min', title: 'You scan as you arrive', body: 'Your name shows up on the rep’s list straight away, with the time and your distance.' },
		{ at: 'Close', title: 'Anyone not scanned becomes absent', body: 'The lecture closes itself, so nobody is left out by an oversight.' },
		{ at: 'After', title: 'Anything can be put right', body: 'A lecturer can correct, excuse or remove any record. What it was before is always kept.' }
	];

	const kept = [
		'Your name and registration number',
		'The exact time you scanned',
		'How far your phone was from the screen',
		'Whether that reading was precise enough to rely on',
		'Which phone the scan came from',
		'Anything that looked odd, and why',
		'Any later change, with the original kept',
		'Whether you disputed it, and your note'
	];

	const sections = [
		['#mark', 'Marking yourself present'],
		['#status', 'What your record says'],
		['#wrong', 'If something goes wrong'],
		['#roles', 'Who does what']
	];

	const viewer = $derived(sessionMe());
	const isAuthed = $derived(sessionStatus() === 'authed' && !!viewer);
	const isStaffViewer = $derived(viewer?.kind === 'staff');
	const isAdminViewer = $derived(
		viewer?.kind === 'staff' && ((viewer as { isAdmin?: boolean }).isAdmin === true || viewer.role === 'admin')
	);
	const dashboardHref = $derived(
		!viewer ? '/signin' : viewer.kind === 'person' ? '/home' : isAdminViewer ? '/admin' : '/manage'
	);
	const dashboardLabel = $derived(
		!viewer
			? 'Sign in'
			: isAdminViewer
				? 'Open admin console'
				: isStaffViewer
					? 'Open lecturer console'
					: 'Go to my account'
	);

	onMount(() => {
		void ensureSession();
	});
</script>

<svelte:head>
	<title>How LAMS works — LAMS</title>
	<meta
		name="description"
		content="How to mark yourself present for a lecture with LAMS: scan the screen at the front of the hall, allow your location, and that is it. What each status means and what to do if something goes wrong."
	/>
</svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-8">
	<section class="flex flex-col items-start gap-3 pt-2">
		<Badge class="gap-1.5 bg-lams-navy text-white"><MonitorSmartphone class="size-3.5" /> In plain language</Badge>
		<h1 class="text-3xl font-extrabold tracking-tight text-lams-navy sm:text-4xl">How it works</h1>
		<p class="max-w-2xl text-muted-foreground">
			Recording your attendance takes about three seconds. You scan a square barcode on the screen at the
			front of the hall, and the rest is written down for you — no paper list, no typing your name, no queue at a
			desk.
		</p>
		<nav aria-label="Sections of this page" class="flex flex-wrap gap-2 pt-1">
			{#each sections as [href, label] (href)}
				<Button variant="outline" size="sm" href={href}>{label}</Button>
			{/each}
		</nav>
	</section>

	<!-- ── Marking present ─────────────────────────────────────────────────── -->
	<section id="mark" aria-labelledby="mark-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="mark-h" class="text-lg">Marking yourself present</Card.Title>
				<Card.Description>Three steps, and only the first one needs your hands.</Card.Description>
			</Card.Header>
			<Card.Content>
				<ol class="grid items-stretch gap-3 md:grid-cols-3">
					{#each steps as step, i (step.title)}
						<li class="flex flex-col gap-2 rounded-lg border border-border bg-lams-light/60 p-4">
							<span class="flex items-center gap-2 text-sm font-semibold text-lams-navy">
								<step.icon class="size-4" aria-hidden="true" /> {i + 1} · {step.title}
							</span>
							<span class="text-sm text-muted-foreground">{step.body}</span>
						</li>
					{/each}
				</ol>

				<Card.Root class="mt-4 border-lams-green/40 bg-lams-green/5">
					<Card.Content class="pt-5">
						<p class="flex items-start gap-2 text-sm">
							<CheckCircle2 class="mt-0.5 size-4 shrink-0 text-lams-green" aria-hidden="true" />
							<span class="text-muted-foreground">
								<span class="font-medium text-foreground">That is genuinely the whole job.</span>
								There is nothing to type, no code to read out, and no app to install. If you have signed in
								before, you can have your attendance recorded before you have put your phone away.
							</span>
						</p>
					</Card.Content>
				</Card.Root>
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

	<!-- ── Statuses ────────────────────────────────────────────────────────── -->
	<section id="status" aria-labelledby="status-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="status-h" class="text-lg">What your record says</Card.Title>
				<Card.Description>
					Nobody works this out for you, and nobody can type it in for you either.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<ul class="grid gap-4 sm:grid-cols-2">
					{#each statuses as s (s.label)}
						<li class="flex items-start gap-3 rounded-lg border border-border p-3">
							<s.icon class="mt-0.5 size-5 shrink-0 text-lams-navy" aria-hidden="true" />
							<div class="min-w-0">
								<p class="text-sm font-semibold">{s.label}</p>
								<p class="text-sm text-muted-foreground">{s.meaning}</p>
							</div>
						</li>
					{/each}
				</ul>
				<p class="mt-4 text-sm text-muted-foreground">
					You can see all of this yourself under <span class="font-medium text-foreground">My attendance</span>,
					including how far your phone was from the screen. If you think any of it is wrong, you can report it
					from the same page.
				</p>
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

	<!-- ── Problems ────────────────────────────────────────────────────────── -->
	<section id="wrong" aria-labelledby="wrong-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="wrong-h" class="flex items-center gap-2 text-lg">
					<HelpCircle class="size-5 text-lams-navy" aria-hidden="true" /> If something goes wrong
				</Card.Title>
				<Card.Description>
					All of these happen in real halls. None of them should cost you the lecture.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<dl class="flex flex-col gap-2">
					{#each problems as p (p.question)}
						<div class="rounded-lg border border-border p-3">
							<dt class="flex items-start gap-2 text-sm font-semibold">
								<p.icon class="mt-0.5 size-4 shrink-0 text-lams-green" aria-hidden="true" />
								<span>{p.question}</span>
							</dt>
							<dd class="mt-1 pl-6 text-sm text-muted-foreground">{p.answer}</dd>
						</div>
					{/each}
				</dl>
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

	<!-- ── Why it cannot be faked, said plainly ────────────────────────────── -->
	<section aria-labelledby="why-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="why-h" class="flex items-center gap-2 text-lg">
					<ShieldCheck class="size-5 text-lams-green" aria-hidden="true" /> Why this is hard to fake
				</Card.Title>
				<Card.Description>
					Four ordinary things working together. None of them slows you down.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<ul class="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
					{#each [
						{ head: 'The screen keeps changing.', body: 'The barcode holds a code that changes every 10 seconds, so a photograph of it stops working almost immediately. There is nothing useful to send to someone at home.' },
						{ head: 'Your phone says where it is.', body: 'It reports its own position at the moment you scan, so being in the hall is checked by your handset rather than by somebody else’s.' },
						{ head: 'The screen has to stay put.', body: 'LAMS knows which room the screen belongs to. If it is carried out of that room it stops recording, so attendance cannot be taken in the wrong place.' },
						{ head: 'You sign in on one phone.', body: 'Your account belongs to the handset you set it up on, so somebody else cannot use your sign-in on theirs.' }
					] as r (r.head)}
						<li class="flex gap-2">
							<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
							<span>
								<b class="font-medium text-foreground">{r.head}</b>
								{r.body}
							</span>
						</li>
					{/each}
				</ul>
				<p class="mt-4 text-sm text-muted-foreground">
					And where a check cannot be certain, it says so rather than guessing. If your phone’s location is too
					imprecise to tell, your record is marked for a person to look at instead of being quietly counted for
					or against you.
				</p>
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

	<!-- ── Roles ────────────────────────────────────────────────────────── -->
	<section aria-labelledby="roles-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="roles-h" class="text-lg">Who does what</Card.Title>
			</Card.Header>
			<Card.Content class="grid gap-4 sm:grid-cols-3">
				{#each roles as role (role.who)}
					<div class="rounded-lg border border-border p-3">
						<p class="flex items-center gap-2 text-sm font-semibold text-lams-navy">
							<role.icon class="size-4" aria-hidden="true" />
							{role.who}
						</p>
						<p class="mt-1 text-sm text-muted-foreground">{role.body}</p>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

	<section aria-labelledby="kept-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="kept-h" class="flex items-center gap-2 text-lg">
					<ClipboardCheck class="size-5 text-lams-green" aria-hidden="true" /> What is written down
				</Card.Title>
				<Card.Description>All of it is visible to you, and you can query any of it.</Card.Description>
			</Card.Header>
			<Card.Content>
				<ul class="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 md:grid-cols-4">
					{#each kept as item (item)}
						<li class="flex items-start gap-2">
							<CircleCheck class="mt-0.5 size-4 shrink-0 text-lams-green" aria-hidden="true" />
							<span>{item}</span>
						</li>
					{/each}
				</ul>
				<p class="mt-4 text-xs text-muted-foreground">
					Only a class rep or lecturer can add a student by hand, and they have to give a reason. Nobody can put
					themselves into a class they do not belong to.
				</p>
			</Card.Content>
		</Card.Root>
	</section>

				<section aria-labelledby="timeline-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="timeline-h" class="flex items-center gap-2 text-lg">
					<DoorOpen class="size-5 text-lams-navy" aria-hidden="true" /> What happens during a lecture
				</Card.Title>
				<Card.Description>The parts you never have to do anything about.</Card.Description>
			</Card.Header>
			<Card.Content>
				<ol class="relative flex flex-col gap-5 border-l-2 border-border pl-6">
					{#each timeline as step (step.at)}
						<li class="relative">
							<span
								class="absolute -left-[1.9rem] top-1 size-3 rounded-full bg-lams-green ring-4 ring-background"
								aria-hidden="true"
							></span>
							<p class="flex flex-wrap items-center gap-2 text-sm font-semibold text-lams-navy">
								<span
									class="rounded bg-lams-light px-1.5 py-0.5 font-mono text-xs font-medium text-lams-navy"
									>{step.at}</span
								>
								{step.title}
							</p>
							<p class="text-sm text-muted-foreground">{step.body}</p>
						</li>
					{/each}
				</ol>
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

			<section class="flex flex-col items-center gap-3 rounded-lg bg-lams-light/70 p-8 text-center">
					<p class="text-lg font-semibold text-lams-navy">That is the whole system.</p>
					<p class="max-w-md text-sm text-muted-foreground">
						{#if isAuthed}
							You are signed in — continue where you left off.
						{:else}
							One scan, one record, and nothing for a student to type. Sign in to see your own attendance, or to run
							a lecture.
						{/if}
					</p>
					<div class="flex flex-wrap justify-center gap-2">
						<Button href={dashboardHref}>{dashboardLabel}</Button>
						<Button variant="outline" href="/">Back to the start</Button>
					</div>
				</section>
			</div>
