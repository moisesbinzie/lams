<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';
	import { ensureSession, sessionMe, sessionStatus } from '$lib/lams/session.svelte';
	import {
		BookOpen,
		Camera,
		CheckCircle2,
		CircleCheck,
		ClipboardCheck,
		Clock,
		GraduationCap,
		HelpCircle,
		MapPin,
		MinusCircle,
		MonitorSmartphone,
		ScanLine,
		Settings,
		ShieldCheck,
		Smartphone,
		XCircle
	} from '@lucide/svelte';

	/**
	 * User guide for LAMS: how each role uses the system, in formal plain
	 * English. Each section is procedural — what to do, in what order — so a
	 * first-year student, a lecturer and an administrator can each read only
	 * their own section and succeed.
	 */

	const studentSteps = [
		{
			icon: BookOpen,
			title: 'Step 1 — Sign in and join your courses',
			body: 'Sign in with your registration number and PIN. Open My courses, select the current semester, and join each course you take. If a course belongs to another programme, use Request to join and wait for approval.'
		},
		{
			icon: Camera,
			title: 'Step 2 — Scan the screen in the hall',
			body: 'When the lecture starts, point your phone camera at the square barcode (QR code) on the screen at the front of the hall. Your phone opens the attendance page automatically.'
		},
		{
			icon: MapPin,
			title: 'Step 3 — Allow your location once',
			body: 'When your phone requests location access, accept it. Your position at the moment of scanning is what confirms that you are inside the hall. Without it, your record cannot be confirmed.'
		},
		{
			icon: CheckCircle2,
			title: 'Step 4 — Confirm and check your record',
			body: 'Your result appears immediately: Present, Late, Out of range, Absent or Excused. Open My attendance at any time to review your full record and report any error.'
		}
	];

	/** Attendance statuses, stated exactly as they appear on the record. */
	const statuses = [
		{ icon: CircleCheck, label: 'Present', meaning: 'You were recorded inside the hall within the on-time window (normally the first 5 minutes).' },
		{ icon: Clock, label: 'Late', meaning: 'You were recorded inside the hall after the on-time window but before the lecture closed (normally within 10 minutes).' },
		{
			icon: MapPin,
			label: 'Out of range',
			meaning:
				'Your phone reported a position outside the 50 metre radius around the screen. If you were in the hall, report the record so your lecturer can review it.'
		},
		{ icon: XCircle, label: 'Absent', meaning: 'No record was submitted for you before the lecture closed.' },
		{
			icon: MinusCircle,
			label: 'Excused',
			meaning: 'Your absence was approved in advance or afterwards. An excused lecture does not count against your attendance rate.'
		}
	];

	const lecturerSteps = [
		{
			icon: BookOpen,
			title: 'Step 1 — Confirm your courses',
			body: 'Open the lecturer console and confirm that each course you teach is assigned to you, with its programme, year of study and semester. Contact the administrator if anything is missing.'
		},
		{
			icon: ScanLine,
			title: 'Step 2 — Start the lecture',
			body: 'Select the course and press Start here. Your current location becomes the lecture position with a 50 metre radius. The station QR code appears on screen for students to scan.'
		},
		{
			icon: MonitorSmartphone,
			title: 'Step 3 — Display the station code',
			body: 'Keep the station screen visible at the front of the hall for the full attendance window. The code changes automatically. If the screen is carried out of the room, scanning stops until it is returned.'
		},
		{
			icon: ClipboardCheck,
			title: 'Step 4 — Review and correct records',
			body: 'After the lecture, open Records to review attendance. You may correct, excuse or remove any record. Every change is kept in the audit trail with the original value. Approve or reject student join requests from the roster.'
		}
	];

	const adminSteps = [
		{
			icon: Settings,
			title: 'Step 1 — Set up the academic structure',
			body: 'Create the academic year and its semesters, then create programmes with their duration in years. Add courses to the catalogue and place each course in the correct programme, year and semester.'
		},
		{
			icon: GraduationCap,
			title: 'Step 2 — Assign lecturers and representatives',
			body: 'Assign each course to its lecturer or lecturers. Register students into their programmes and appoint programme representatives where required.'
		},
		{
			icon: ShieldCheck,
			title: 'Step 3 — Oversee attendance and enrolment',
			body: 'Review attendance across all lectures, semesters and programmes. Decide disputed records, approve join requests that lecturers have not handled, and re-admit students who were automatically withdrawn where appropriate.'
		},
		{
			icon: ClipboardCheck,
			title: 'Step 4 — Maintain accurate records',
			body: 'Export attendance reports for official use. Withdraw students who are no longer taking a course; their past attendance is always retained. A student with four consecutive absences in one course is withdrawn automatically and shown as Withdrawn.'
		}
	];

	const faqs = [
		{
			icon: MapPin,
			question: 'My record states Out of range, but I was in the hall. What should I do?',
			answer:
				'Mobile telephones are less accurate indoors, particularly in crowded halls. Open My attendance, select the record and report it with a short note. Your programme representative or lecturer will review the evidence and correct the record where appropriate. The original value is always retained.'
		},
		{
			icon: Smartphone,
			question: 'My telephone cannot provide a location. Is my attendance lost?',
			answer:
				'No. Your scan is still submitted and is marked for lecturer review. Enable location access for the browser you scan with so that subsequent lectures are confirmed automatically.'
		},
		{
			icon: Camera,
			question: 'I have no telephone, or my camera cannot read the code. How is my attendance recorded?',
			answer:
				'Your programme representative can add you manually. They are required to state a reason, and their name is recorded on the entry. This is a standard procedure and is not held against you.'
		},
		{
			icon: Clock,
			question: 'The station code has expired. What should I do?',
			answer:
				'The station code changes at short intervals so that a photograph of the screen cannot be reused. Scan the screen again; the attendance page opens automatically.'
		},
		{
			icon: ShieldCheck,
			question: 'A record on my account is incorrect. How do I challenge it?',
			answer:
				'Open My attendance and report the record, stating what occurred. Your programme representative or lecturer will examine it and amend it if necessary. You will retain the full history of the change.'
		},
		{
			icon: BookOpen,
			question: 'I cannot find my course in the list. How do I join it?',
			answer:
				'Open My courses and select the correct semester, then search by course code or title. If the course belongs to your programme, press Join. If it belongs to another programme, press Request to join; your lecturer will approve or reject the request.'
		},
		{
			icon: XCircle,
			question: 'My course states Withdrawn. What does this mean?',
			answer:
				'You were withdrawn from the course after four consecutive absences. Your previous attendance records are retained. Speak to your lecturer if you believe this is incorrect; they can re-admit you.'
		},
		{
			icon: ScanLine,
			question: 'I am a lecturer. How do I start a lecture quickly?',
			answer:
				'Open Take attendance, select the course and press Start here. Your current location is used with a 50 metre radius. Advanced settings remain available for typing coordinates manually, repositioning the screen, or changing the on-time and late windows.'
		}
	];

	const sections = [
		['#student', 'For students'],
		['#lecturer', 'For lecturers'],
		['#admin', 'For administrators'],
		['#faq', 'Frequently asked questions']
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
	<title>How to use LAMS — LAMS</title>
	<meta
		name="description"
		content="How to use LAMS: instructions for students marking attendance, lecturers starting lectures, and administrators managing records. Includes frequently asked questions."
	/>
</svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 lg:max-w-5xl">
	<section class="flex flex-col items-start gap-3 pt-2">
		<Badge class="gap-1.5 bg-lams-navy text-white"><MonitorSmartphone class="size-3.5" /> User guide</Badge>
		<h1 class="text-3xl font-extrabold tracking-tight text-lams-navy sm:text-4xl">How to use LAMS</h1>
		<p class="max-w-2xl text-muted-foreground">
			LAMS records lecture attendance electronically. Students scan the code displayed on the
			screen at the front of the hall; the system records their name, the time and their
			distance from the screen. This guide explains how to use the system as a student, as a
			lecturer and as an administrator.
		</p>
		<nav aria-label="Sections of this page" class="flex flex-wrap gap-2 pt-1">
			{#each sections as [href, label] (href)}
				<Button variant="outline" size="sm" href={href}>{label}</Button>
			{/each}
		</nav>
	</section>

	<!-- ── Students ──────────────────────────────────────────────────────── -->
	<section id="student" aria-labelledby="student-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="student-h" class="text-lg">For students — marking your attendance</Card.Title>
				<Card.Description>Follow these four steps for every lecture you attend.</Card.Description>
			</Card.Header>
			<Card.Content>
				<ol class="grid items-stretch gap-3 md:grid-cols-2">
					{#each studentSteps as step (step.title)}
						<li class="flex flex-col gap-2 rounded-lg border border-border bg-lams-light/60 p-4">
							<span class="flex items-center gap-2 text-sm font-semibold text-lams-navy">
								<step.icon class="size-4" aria-hidden="true" /> {step.title}
							</span>
							<span class="text-sm text-muted-foreground">{step.body}</span>
						</li>
					{/each}
				</ol>
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

	<!-- ── Statuses ──────────────────────────────────────────────────────── -->
	<section aria-labelledby="status-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="status-h" class="text-lg">What your attendance record means</Card.Title>
				<Card.Description>
					Every record carries one of the following statuses.
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
					All records are available under <span class="font-medium text-foreground">My attendance</span>,
					including the distance recorded for each scan. Any record may be reported from the same page.
				</p>
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

	<!-- ── Lecturers ─────────────────────────────────────────────────────── -->
	<section id="lecturer" aria-labelledby="lecturer-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="lecturer-h" class="text-lg">For lecturers — managing lectures</Card.Title>
				<Card.Description>Prepare the course, start the lecture and review the records.</Card.Description>
			</Card.Header>
			<Card.Content>
				<ol class="grid items-stretch gap-3 md:grid-cols-2">
					{#each lecturerSteps as step (step.title)}
						<li class="flex flex-col gap-2 rounded-lg border border-border bg-lams-light/60 p-4">
							<span class="flex items-center gap-2 text-sm font-semibold text-lams-navy">
								<step.icon class="size-4" aria-hidden="true" /> {step.title}
							</span>
							<span class="text-sm text-muted-foreground">{step.body}</span>
						</li>
					{/each}
				</ol>
				<p class="mt-4 text-sm text-muted-foreground">
					To start a lecture, select the course and press Start here. Your current location is
					used automatically with a 50 metre radius. Students who are absent for four consecutive
					lectures in one course are withdrawn from that course automatically; their previous
					records are retained and they appear as Withdrawn on the roster.
				</p>
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

	<!-- ── Administrators ────────────────────────────────────────────────── -->
	<section id="admin" aria-labelledby="admin-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="admin-h" class="text-lg">For administrators — oversight and records</Card.Title>
				<Card.Description>Configure the institution, assign staff and maintain accurate records.</Card.Description>
			</Card.Header>
			<Card.Content>
				<ol class="grid items-stretch gap-3 md:grid-cols-2">
					{#each adminSteps as step (step.title)}
						<li class="flex flex-col gap-2 rounded-lg border border-border bg-lams-light/60 p-4">
							<span class="flex items-center gap-2 text-sm font-semibold text-lams-navy">
								<step.icon class="size-4" aria-hidden="true" /> {step.title}
							</span>
							<span class="text-sm text-muted-foreground">{step.body}</span>
						</li>
					{/each}
				</ol>
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

	<!-- ── FAQ ───────────────────────────────────────────────────────────── -->
	<section id="faq" aria-labelledby="faq-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="faq-h" class="flex items-center gap-2 text-lg">
					<HelpCircle class="size-5 text-lams-navy" aria-hidden="true" /> Frequently asked questions
				</Card.Title>
				<Card.Description>
					Answers to the questions most commonly raised by students, lecturers and administrators.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<dl class="flex flex-col gap-2">
					{#each faqs as f (f.question)}
						<div class="rounded-lg border border-border p-3">
							<dt class="flex items-start gap-2 text-sm font-semibold">
								<f.icon class="mt-0.5 size-4 shrink-0 text-lams-green" aria-hidden="true" />
								<span>{f.question}</span>
							</dt>
							<dd class="mt-1 pl-6 text-sm text-muted-foreground">{f.answer}</dd>
						</div>
					{/each}
				</dl>
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

	<section class="flex flex-col items-center gap-3 rounded-lg bg-lams-light/70 p-8 text-center">
		<p class="text-lg font-semibold text-lams-navy">Attendance in three seconds.</p>
		<p class="max-w-md text-sm text-muted-foreground">
			{#if isAuthed}
				You are signed in — continue where you left off.
			{:else}
				One scan records your name, time and distance automatically. Sign in to view your
				attendance or to run a lecture.
			{/if}
		</p>
		<div class="flex flex-wrap justify-center gap-2">
			<Button href={dashboardHref}>{dashboardLabel}</Button>
			<Button variant="outline" href="/">Back to the start</Button>
		</div>
	</section>
</div>
