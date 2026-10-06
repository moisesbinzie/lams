<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import {
		ScanLine,
		MapPin,
		Timer,
		UserRound,
		UsersRound,
		GraduationCap,
		ShieldCheck,
		ClipboardCheck,
		Smartphone,
		CalendarDays,
		BookOpen,
		BarChart3,
		ArrowRight
	} from '@lucide/svelte';

	const steps = [
		{
			icon: ClipboardCheck,
			title: '1 · Your lecturer adds you',
			body: 'Your class rep or lecturer adds every student to their class. Nobody can add themselves, so only real students appear on the list.'
		},
		{
			icon: BookOpen,
			title: '2 · You pick your subjects',
			body: 'Sign in and choose the subjects you are taking. Your lecturer opens each one, and your timetable builds itself.'
		},
		{
			icon: ScanLine,
			title: '3 · You scan the screen',
			body: 'Point your phone camera at the QR on the screen at the front of the hall. Your name, the time and how far you are from the screen are recorded for you.'
		}
	];

	const roles = [
		{
			icon: UserRound,
			title: 'Students',
			tone: 'text-lams-navy',
			lines: [
				'Sign in with your registration number and PIN.',
				'Scan the QR on the screen with your own camera — it refreshes every 10 seconds.',
				'Check your own attendance and report anything wrong.'
			]
		},
		{
			icon: UsersRound,
			title: 'Class representatives',
			tone: 'text-lams-green',
			lines: [
				'Add students to your class and assign subjects.',
				'Put the station QR on your screen at the front of the hall.',
				'Add anyone without a working phone by hand — under your name.'
			]
		},
		{
			icon: GraduationCap,
			title: 'Lecturers',
			tone: 'text-lams-navy',
			lines: [
				'Set up subjects, classes and timetables.',
				'Open enrolment and choose class reps.',
				'Correct, excuse or remove any record.'
			]
		},
		{
			icon: ShieldCheck,
			title: 'Administrators',
			tone: 'text-lams-green',
			lines: [
				'Review attendance across all past lectures.',
				'See exactly who recorded each entry.',
				'Download a full list for your records.'
			]
		}
	];
</script>

<div class="flex flex-col gap-8">
	<section class="grid items-center gap-8 py-4 md:grid-cols-[1.15fr_1fr]">
		<div class="flex flex-col items-start gap-4">
			<div class="flex flex-wrap items-center gap-2">
				<Badge class="gap-1.5 bg-lams-navy text-white"><MapPin class="size-3.5" /> Location checked</Badge>
				<Badge class="gap-1.5 bg-lams-green text-white"><Timer class="size-3.5" /> Closes itself</Badge>
				<Badge variant="outline" class="gap-1.5"><Smartphone class="size-3.5" /> Works on any phone</Badge>
			</div>
			<h1 class="text-3xl font-extrabold tracking-tight text-lams-navy sm:text-4xl">
				Attendance in seconds, not minutes.
			</h1>
			<p class="max-w-xl text-muted-foreground">
				LAMS replaces the paper register. Students scan a QR code on the screen at the front of the hall, and
				the date, time and their distance from the screen are recorded automatically. The lecture closes
				itself and your percentages add up on their own.
			</p>
			<div class="flex flex-wrap gap-2">
				<Button href="/signin" size="lg">Sign in</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				New here? Ask your class representative or lecturer to add you, then set your PIN.
			</p>
		</div>
		<div class="flex justify-center">
			<img
				src="/lams-logo.png"
				alt="LAMS — Lecture Attendance Monitoring System"
				class="w-56 rounded-2xl shadow-sm sm:w-72"
			/>
		</div>
	</section>

	<section aria-label="How attendance works" class="grid gap-4 md:grid-cols-3">
		{#each steps as step (step.title)}
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex items-center gap-2 text-base">
						<span class="flex size-9 items-center justify-center rounded-lg bg-secondary text-lams-navy">
							<step.icon class="size-5" />
						</span>
						{step.title}
					</Card.Title>
				</Card.Header>
				<Card.Content>
					<p class="text-sm text-muted-foreground">{step.body}</p>
				</Card.Content>
			</Card.Root>
		{/each}
	</section>

	<div class="-mt-4 flex justify-center">
		<Button variant="outline" size="sm" href="/how-it-works">
			See the whole flow as diagrams
			<ArrowRight class="size-3.5" />
		</Button>
	</div>

	<section class="grid gap-4 md:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<Timer class="size-5 text-lams-green" /> How your status is decided
				</Card.Title>
				<Card.Description>
					Set automatically from the clock and where you are. You never type any of it. Your lecturer can
					change the times.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-2 text-sm text-muted-foreground">
				<div class="flex flex-wrap items-center gap-2">
					<StatusBadge status="Present" /> inside the hall, within 5 minutes of the start.
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<StatusBadge status="Late" /> inside the hall, between 5 and 10 minutes.
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<StatusBadge status="Absent" /> later than 10 minutes after the start.
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<StatusBadge status="Out_of_Range" /> too far from the lecture hall — sent to your lecturer to review.
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<StatusBadge status="Excused" /> an absence your lecturer approves. This one does not count against you.
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<CalendarDays class="size-5 text-lams-green" /> Timetables and subjects
				</Card.Title>
				<Card.Description>
					Subjects are saved once and reused. Lecturers build the weekly timetable, and everybody sees their
					own.
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3 text-sm text-muted-foreground">
				<ul class="flex flex-col gap-1.5">
					<li class="flex gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
						<span>Subjects sit in a catalogue, so they are only entered once.</span>
					</li>
					<li class="flex gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
						<span>A class is offered a subject in a given semester, with its own weekly meeting times.</span>
					</li>
					<li class="flex gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
						<span>Extra lectures arranged outside the normal week appear as make-ups.</span>
					</li>
					<li class="flex gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
						<span>Records are kept for your whole time at the school, and you can check by semester, month or week.</span>
					</li>
				</ul>
			</Card.Content>
		</Card.Root>
	</section>

	<Separator />

	<section aria-label="Who uses LAMS" class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
		{#each roles as role (role.title)}
			<Card.Root>
				<Card.Header>
					<Card.Title class="flex items-center gap-2 text-base">
						<role.icon class="size-5 {role.tone}" />
						{role.title}
					</Card.Title>
				</Card.Header>
				<Card.Content>
					<ul class="space-y-1.5 text-sm text-muted-foreground">
						{#each role.lines as line (line)}
							<li class="flex gap-2">
								<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
								<span>{line}</span>
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		{/each}
	</section>

	<section>
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<ShieldCheck class="size-5 text-lams-green" /> How we know it is really you
				</Card.Title>
				<Card.Description>
					Scanning is quick, so these checks run in the background without slowing anyone down.
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<ul class="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
					<li class="flex gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
						<span
							>Only a class rep or lecturer can add a student, so nobody can put themselves into a class
							they do not belong to.</span
						>
					</li>
					<li class="flex gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
						<span
							>Your account works on one phone only. If someone signs in as you on a different phone, it is
							refused.</span
						>
					</li>
					<li class="flex gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
						<span
							>The code on the screen changes every 10 seconds, so a photo of the screen stops working almost
							immediately.</span
						>
					</li>
					<li class="flex gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
						<span
							>Your own phone reports where it is at the moment you scan, so being in the hall is checked
							by your device and not anyone else's.</span
						>
					</li>
					<li class="flex gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
						<span>One scan per student per lecture, so the same code cannot be used twice.</span>
					</li>
					<li class="flex gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-lams-green" aria-hidden="true"></span>
						<span
							>You can see every record made in your name, who made it, and report anything that is
							wrong.</span
						>
					</li>
				</ul>
			</Card.Content>
		</Card.Root>
	</section>

	<section class="grid gap-4 md:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<GraduationCap class="size-5 text-lams-green" /> For lecturers
				</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				<p class="text-sm text-muted-foreground">
					Set up subjects, classes and semesters, decide who can enrol, build the weekly timetable, choose
					class reps, start lectures and change any record afterwards.
				</p>
				<Button variant="outline" size="sm" href="/signin">Sign in to continue</Button>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<BarChart3 class="size-5 text-lams-green" /> Records
				</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3">
				<p class="text-sm text-muted-foreground">
					See how much of each lecture everyone attended, spot anyone falling behind, and download a full list
					for your department. Approved absences count separately so they never work against a student.
				</p>
				<Button variant="outline" size="sm" href="/signin">Sign in to continue</Button>
			</Card.Content>
		</Card.Root>
	</section>
</div>