<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';
	import {
		ArrowRight,
		BookOpen,
		CalendarDays,
		CircleCheck,
		ClipboardCheck,
		Clock,
		Fingerprint,
		MapPin,
		MapPinCheck,
		QrCode,
		Radio,
		RotateCw,
		ScanLine,
		Server,
		ShieldCheck,
		Smartphone,
		TriangleAlert,
		Users,
		UsersRound
	} from '@lucide/svelte';
	import { stationCodeForSlot, stationSlotAt } from '$lib/lams/station';

	/**
	 * The four gates a scan has to pass, in the order the server applies them.
	 * Order is not decoration — each gate is cheaper than the one after it, so a
	 * forged token is dropped before anything is looked up.
	 */
	const gates = [
		{
			icon: Fingerprint,
			question: 'Is this the phone the account is bound to?',
			detail: 'Compared against the sign-in session and the bound device.',
			stops: 'A token copied, restored from a backup, or synced to another handset.'
		},
		{
			icon: QrCode,
			question: 'Is this the code on the screen right now?',
			detail: 'A six-digit code that rolls every 30 seconds, unique to this lecture.',
			stops: 'A photo of the screen, redeemed later.'
		},
		{
			icon: Clock,
			question: 'Is the lecture still open?',
			detail: 'Nothing is accepted after the window closes.',
			stops: 'Yesterday’s code, or a lecture that has finished.'
		},
		{
			icon: BookOpen,
			question: 'Is this student enrolled in this subject?',
			detail: 'Checked against the offering, not against a year or a class name.',
			stops: 'Marking attendance for someone not taking the class.'
		},
		{
			icon: ShieldCheck,
			question: 'Have they already been recorded?',
			detail: 'One record per student per lecture, however many times they scan.',
			stops: 'The same code being spent twice.'
		},
		{
			icon: MapPin,
			question: 'How far is their phone from the station?',
			detail: 'Measured by the scanning device, at the moment it scanned.',
			stops: 'Redeeming a shared code from outside the hall.'
		}
	];

	const timeline = [
		{ at: 'Before', title: 'A rep or lecturer opens the lecture', body: 'They set where the station is, how big the radius is, and how long students have to arrive.' },
		{ at: '0:00', title: 'The station appears on screen', body: 'A secret is minted for this lecture only, and a QR is shown at the front of the hall.' },
		{ at: 'Every 30s', title: 'The code inside it changes', body: 'So a photograph of the screen stops working almost at once.' },
		{ at: '0–10 min', title: 'Students scan as they arrive', body: 'Each record lands in the rep’s list straight away, with its distance and any flag.' },
		{ at: 'On close', title: 'Anyone not recorded becomes Absent', body: 'The lecture also closes itself if nobody forgets to.' },
		{ at: 'After', title: 'A lecturer can review anything', body: 'Correct, excuse or remove any record. The previous value is always kept.' }
	];

	/**
	 * A live sample of the real generator, so the rolling behaviour is shown
	 * rather than described. The secret below is a throwaway constant with no
	 * lecture attached to it — these codes will not verify against anything.
	 */
	const DEMO_SECRET = 'illustration-only-not-a-real-lecture-secret';
	let now = $state(0);
	const demoCodes = $derived.by(() => {
		const slot = stationSlotAt(now || 1);
		return [-3, -2, -1, 0].map((offset) => ({
			code: stationCodeForSlot(DEMO_SECRET, slot + offset),
			past: offset < 0
		}));
	});

	onMount(() => {
		now = Date.now();
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});
</script>

<svelte:head>
	<title>How LAMS works — LAMS</title>
	<meta
		name="description"
		content="How lecture attendance is recorded in LAMS: a rotating QR at the front of the hall, a distance check from the student's own phone, and an audit trail a person can read."
	/>
</svelte:head>

<div class="flex flex-col gap-8">
	<section class="flex flex-col items-start gap-3 pt-2">
		<Badge class="gap-1.5 bg-lams-navy text-white"><Radio class="size-3.5" /> The whole flow, end to end</Badge>
		<h1 class="text-3xl font-extrabold tracking-tight text-lams-navy sm:text-4xl">How it works</h1>
		<p class="max-w-2xl text-muted-foreground">
			Attendance is one scan. Everything else — who you are, what time it is, how far you
			are from the front of the hall, whether you were here at all — is worked out for you
			and written to a record your lecturer can read afterwards.
		</p>
		<nav aria-label="Sections of this page" class="flex flex-wrap gap-2 pt-1">
			{#each [['#scan', 'The scan'], ['#gates', 'The checks'], ['#timeline', 'A lecture'], ['#status', 'Your status']] as [href, label] (href)}
				<Button variant="outline" size="sm" href={href}>{label}</Button>
			{/each}
		</nav>
	</section>

	<!-- ── The scan ─────────────────────────────────────────────────────── -->
	<section id="scan" aria-labelledby="scan-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="scan-h" class="text-lg">What happens when a student scans</Card.Title>
				<Card.Description>
					Three parties. The important detail is which phone is measuring the distance.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-5">
				<ol class="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
					<li class="flex flex-col gap-2 rounded-lg border border-border bg-lams-light/60 p-4">
						<span class="flex items-center gap-2 text-sm font-semibold text-lams-navy">
							<Server class="size-4" aria-hidden="true" /> 1 · The station
						</span>
						<span class="text-sm text-muted-foreground">
							A screen at the front of the hall shows a QR. The code inside it is new every 30
							seconds and belongs to this lecture alone.
						</span>
					</li>

					<li class="flex items-center justify-center" aria-hidden="true">
						<div class="flex flex-col items-center gap-1">
							<ArrowRight class="size-5 rotate-90 text-muted-foreground md:rotate-0" />
							<span class="text-[0.65rem] text-muted-foreground">camera</span>
						</div>
					</li>

					<li class="flex flex-col gap-2 rounded-lg border border-border bg-lams-green/10 p-4">
						<span class="flex items-center gap-2 text-sm font-semibold text-lams-green">
							<Smartphone class="size-4" aria-hidden="true" /> 2 · The student’s phone
						</span>
						<span class="text-sm text-muted-foreground">
							The link opens LAMS. It already knows who is signed in, so the student types
							nothing — the only thing asked for is location.
						</span>
					</li>

					<li class="flex items-center justify-center" aria-hidden="true">
						<div class="flex flex-col items-center gap-1">
							<ArrowRight class="size-5 rotate-90 text-muted-foreground md:rotate-0" />
							<span class="text-[0.65rem] text-muted-foreground">one request</span>
						</div>
					</li>

					<li class="flex flex-col gap-2 rounded-lg border border-border bg-secondary p-4">
						<span class="flex items-center gap-2 text-sm font-semibold text-lams-navy">
							<Server class="size-4" aria-hidden="true" /> 3 · The server
						</span>
						<span class="text-sm text-muted-foreground">
							Receives the code, this device’s id and its position, checks all six gates, and
							writes one record.
						</span>
					</li>
				</ol>

				<Card.Root class="border-lams-green/40 bg-lams-green/5">
					<Card.Content class="pt-5">
						<p class="flex items-start gap-2 text-sm">
							<MapPinCheck class="mt-0.5 size-4 shrink-0 text-lams-green" aria-hidden="true" />
							<span class="text-muted-foreground">
								<span class="font-medium text-foreground">The distance is measured by the student’s own
									phone.</span>
								Not the rep’s, not a proxy — the handset that scanned the code is the one
								reporting how far it is from the screen it just read, at that instant. That is
								what makes “in range” mean something.
							</span>
						</p>
					</Card.Content>
				</Card.Root>

				<div>
					<p class="mb-2 text-sm font-medium">The code on the station, rolling</p>
					<p class="mb-3 text-xs text-muted-foreground">
						Live output from the same generator the station uses. This is an illustration with no
						lecture behind it — these codes will not verify against anything.
					</p>
					<ol class="flex flex-wrap gap-2">
						{#each demoCodes as c (c.code + String(c.past))}
							<li
								class="flex flex-col items-center gap-1 rounded-lg border px-4 py-2 {c.past
									? 'border-border bg-muted/40 text-muted-foreground line-through'
									: 'border-lams-green bg-lams-green/10 text-lams-navy'}"
							>
								<span class="font-mono text-lg font-semibold tracking-[0.15em]">{c.code}</span>
								<span class="flex items-center gap-1 text-[0.65rem]">
									{#if c.past}
										gone
									{:else}
										<RotateCw class="size-2.5" aria-hidden="true" /> now
									{/if}
								</span>
							</li>
						{/each}
					</ol>
				</div>
			</Card.Content>
		</Card.Root>
	</section>

	<!-- ── The gates ────────────────────────────────────────────────────── -->
	<section id="gates" aria-labelledby="gates-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="gates-h" class="text-lg">The six checks, in order</Card.Title>
				<Card.Description>
					Each one is cheaper than the next, so a bad token is dropped before anything is looked up.
					Every check runs in the background — none of it slows a student down.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<ol class="flex flex-col gap-2">
					{#each gates as gate, i (gate.question)}
						<li class="flex items-start gap-3 rounded-lg border border-border p-3">
							<span
								class="flex size-8 shrink-0 items-center justify-center rounded-full bg-lams-navy text-sm font-semibold text-white"
								aria-hidden="true">{i + 1}</span
							>
							<div class="min-w-0 flex-1">
								<p class="flex items-center gap-2 text-sm font-medium">
									<gate.icon class="size-4 shrink-0 text-lams-green" aria-hidden="true" />
									{gate.question}
								</p>
								<p class="text-xs text-muted-foreground">{gate.detail}</p>
								<p class="mt-1 text-xs">
									<span class="font-medium">Stops:</span>
									<span class="text-muted-foreground">{gate.stops}</span>
								</p>
							</div>
						</li>
					{/each}
				</ol>
			</Card.Content>
		</Card.Root>
	</section>

	<!-- ── Timeline ─────────────────────────────────────────────────────── -->
	<section id="timeline" aria-labelledby="timeline-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="timeline-h" class="text-lg">A lecture, start to finish</Card.Title>
				<Card.Description>What a rep does, and what happens without any input.</Card.Description>
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

	<!-- ── Status decision ──────────────────────────────────────────────── -->
	<section id="status" aria-labelledby="status-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="status-h" class="text-lg">How a status is decided</Card.Title>
				<Card.Description>
					Nobody types this in. Distance is checked first, because being in the room is the
					condition worth knowing about.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				<div class="rounded-lg border-2 border-border p-4">
					<p class="text-sm font-medium">Could the position be judged at all?</p>
					<div class="mt-2 grid gap-2 sm:grid-cols-2">
						<div class="rounded-md bg-amber-50 p-3">
							<p class="flex items-center gap-1.5 text-sm font-medium text-amber-900">
								<TriangleAlert class="size-4" aria-hidden="true" /> No — missing or too coarse
							</p>
							<p class="mt-1 text-xs text-amber-900/80">
								A ±150 m reading cannot tell a seat inside from a corridor outside. The
								distance is left out of the decision, the clock decides, and the record is
								flagged for a person to look at.
							</p>
						</div>
						<div class="rounded-md bg-lams-green/10 p-3">
							<p class="flex items-center gap-1.5 text-sm font-medium text-lams-navy">
								<CircleCheck class="size-4 text-lams-green" aria-hidden="true" /> Yes — a usable fix
							</p>
							<p class="mt-1 text-xs text-muted-foreground">
								The reading is compared with the station radius, and the result is recorded
								against the student’s name.
							</p>
						</div>
					</div>
				</div>

				<div class="rounded-lg border-2 border-border p-4">
					<p class="text-sm font-medium">Inside the radius?</p>
					<div class="mt-2 grid gap-2 sm:grid-cols-2">
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm font-medium text-red-900">No → Out of Range</p>
							<p class="mt-1 text-xs text-red-900/80">
								Flagged for review however early the student arrived. Being seen is the thing a
								lecturer needs to decide on, not absorb.
							</p>
						</div>
						<div class="rounded-md bg-muted/40 p-3">
							<p class="text-sm font-medium">Yes → the clock decides</p>
							<div class="mt-2 flex flex-wrap gap-1.5 text-xs">
								<span class="rounded bg-lams-green/15 px-2 py-1 font-medium text-lams-navy"
									>within 5 min · Present</span
								>
								<span class="rounded bg-amber-100 px-2 py-1 font-medium text-amber-900"
									>5–10 min · Late</span
								>
								<span class="rounded bg-red-100 px-2 py-1 font-medium text-red-900"
									>after 10 min · Absent</span
								>
							</div>
							<p class="mt-2 text-xs text-muted-foreground">
								A late arrival is still recorded rather than rejected, so a lecturer can see that
								the student did turn up and change it if there is a reason. Both thresholds are
								settable per lecture.
							</p>
						</div>
					</div>
				</div>
			</Card.Content>
		</Card.Root>
	</section>

	<!-- ── Roles ────────────────────────────────────────────────────────── -->
	<section aria-labelledby="roles-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="roles-h" class="text-lg">Who does what</Card.Title>
			</Card.Header>
			<Card.Content class="grid gap-3 sm:grid-cols-3">
				{#each [
					{ icon: ScanLine, who: 'Student', body: 'Scan the screen. Allow location. That is the whole job — your name, the time and your distance are recorded for you.' },
					{ icon: UsersRound, who: 'Class rep', body: 'Run the station at the front of the hall. Add students by hand when a phone is not working, with a reason against your name.' },
					{ icon: ClipboardCheck, who: 'Lecturer', body: 'Set up classes and subjects, open the lecture, and correct or excuse any record afterwards. Everything they change is logged.' }
				] as role (role.who)}
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

	<section aria-labelledby="data-h" class="scroll-mt-20">
		<Card.Root>
			<Card.Header>
				<Card.Title id="data-h" class="flex items-center gap-2 text-base">
					<CalendarDays class="size-4 text-lams-green" aria-hidden="true" /> What a record holds
				</Card.Title>
				<Card.Description>
					Visible to the student at <code class="rounded bg-muted px-1 py-0.5 text-xs">/attendance</code>,
					who can dispute anything that looks wrong.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<ul class="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
					{#each ['Your name and registration number', 'The exact time of the scan', 'How far your phone was from the station', 'Whether that fix was precise enough to trust', 'The device the scan came from', 'Any flag, and why it was raised', 'Any later change, with the previous value kept', 'Whether you disputed it, and your note'] as item (item)}
						<li class="flex items-start gap-2">
							<CircleCheck class="mt-0.5 size-4 shrink-0 text-lams-green" aria-hidden="true" />
							<span>{item}</span>
						</li>
					{/each}
				</ul>
				<p class="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
					<Users class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
					<span>
						Only a class rep or lecturer can add a student, so nobody can put themselves into a class
						they do not belong to.
					</span>
				</p>
			</Card.Content>
					</Card.Root>
				</section>

				<section class="flex flex-col items-center gap-3 rounded-lg bg-lams-light/70 p-8 text-center">
					<p class="text-lg font-semibold text-lams-navy">That is the whole system.</p>
					<p class="max-w-md text-sm text-muted-foreground">
						One scan, one record, and nothing for a student to type. Sign in to see your own attendance, or to run
						a lecture.
					</p>
					<div class="flex flex-wrap justify-center gap-2">
						<Button href="/signin">Sign in</Button>
						<Button variant="outline" href="/">Back to the start</Button>
					</div>
				</section>
			</div>