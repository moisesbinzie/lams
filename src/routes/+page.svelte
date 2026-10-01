<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import StatusBadge from '$lib/lams/status-badge.svelte';
	import { getConvexClient } from '$lib/convexClient';
	import {
		ScanLine,
		MapPin,
		Timer,
		UserRound,
		UsersRound,
		GraduationCap,
		ShieldCheck,
		QrCode,
		ClipboardList,
		Printer,
		Wifi,
		Fingerprint
	} from '@lucide/svelte';

	const convexOk = getConvexClient() !== null;

	const steps = [
		{
			icon: QrCode,
			title: '1 · Lecturer starts a session',
			body: 'Sets the lecture location and radius, then displays the signed QR code. Valid for exactly 5 minutes by default — the QR dies the moment the window closes.'
		},
		{
			icon: ScanLine,
			title: '2 · Students scan and go',
			body: 'Registration number only — name and student ID resolve from the roster. GPS is captured automatically, never typed.'
		},
		{
			icon: ClipboardList,
			title: '3 · Attendance lands live',
			body: 'Present, Late or Out of Range is decided automatically. Reps register students without phones; the lecturer reviews and exports.'
		}
	];

	const roles = [
		{
			icon: UserRound,
			title: 'Students',
			tone: 'text-lams-navy',
			lines: [
				'No account, no app, no dashboard.',
				'Scan → confirm → done in seconds.',
				'See your status and distance instantly.'
			]
		},
		{
			icon: UsersRound,
			title: 'Class representatives',
			tone: 'text-lams-green',
			lines: [
				'For students genuinely without a phone.',
				'Authorised reps register two or more in one batch.',
				'Your GPS is the location proxy; every entry is tagged with your name.'
			]
		},
		{
			icon: GraduationCap,
			title: 'Lecturers',
			tone: 'text-lams-navy',
			lines: [
				'Create terms, courses and rosters.',
				'Monitor submissions from the office in real time.',
				'Override, excuse or remove records; export CSV / PDF.'
			]
		},
		{
			icon: ShieldCheck,
			title: 'Administrators',
			tone: 'text-lams-green',
			lines: [
				'Read-only records review.',
				'Every session, every submission, with who registered whom.',
				'CSV export for academic records.'
			]
		}
	];
</script>


<div class="flex flex-col gap-8">
	<section class="grid items-center gap-8 py-4 md:grid-cols-[1.15fr_1fr]">
		<div class="flex flex-col items-start gap-4">
			<div class="flex flex-wrap items-center gap-2">
				<Badge class="gap-1.5 bg-lams-navy text-white"><Wifi class="size-3.5" /> QR + GPS</Badge>
				<Badge class="gap-1.5 bg-lams-green text-white"><Timer class="size-3.5" /> 5-min window</Badge>
				<Badge variant="outline" class="gap-1.5"><Fingerprint class="size-3.5" /> No login for students</Badge>
			</div>
			<h1 class="text-3xl font-extrabold tracking-tight text-lams-navy sm:text-4xl">
				Lecture attendance in seconds, not minutes.
			</h1>
			<p class="max-w-xl text-muted-foreground">
				LAMS replaces the paper register: the lecturer shows a QR code, students scan and confirm, and the
				system records the date, time, GPS distance from the lecture hall and attendance status
				automatically. Sessions close themselves and percentages add up on their own.
			</p>
			<div class="flex flex-wrap gap-2">
				<Button href="/lecturer" size="lg">Open lecturer dashboard</Button>
				<Button href="/records" variant="outline" size="lg">Review records</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				Backend status:
				{#if convexOk}
					<span class="font-medium text-emerald-700">connected</span> — live data available.
				{:else}
					<span class="font-medium text-red-700">not configured</span> — set PUBLIC_CONVEX_URL in .env.local.
				{/if}
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

	<section aria-label="How LAMS works" class="grid gap-4 md:grid-cols-3">
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

	<section class="grid gap-4 md:grid-cols-2">
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2">
					<MapPin class="size-5 text-lams-green" /> Status rules
				</Card.Title>
				<Card.Description>Automatic, based on the time window and GPS distance — never typed by the student.</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-2 text-sm text-muted-foreground">
				<div class="flex items-center gap-2"><StatusBadge status="Present" /> inside the radius, within the Present window.</div>
				<div class="flex items-center gap-2"><StatusBadge status="Late" /> inside the radius, after the Present window (until close).</div>
				<div class="flex items-center gap-2"><StatusBadge status="Out_of_Range" /> GPS distance exceeds the permitted radius — flagged for review.</div>
				<div class="flex items-center gap-2"><StatusBadge status="Absent" /> on the roster with no submission when the session closes.</div>
				<div class="flex items-center gap-2"><StatusBadge status="Excused" /> lecturer override, reported as a separate percentage.</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Key principle</Card.Title>
				<Card.Description>Spec §23 — the student does as little as possible; the system does the rest.</Card.Description>
			</Card.Header>
			<Card.Content class="flex flex-col gap-3 text-sm text-muted-foreground">
				<p class="rounded-lg border border-lams-green/30 bg-secondary p-3 text-secondary-foreground">
					A student scans the QR and confirms their registration number. Date, time, lecture location,
					distance, session validation and status are all recorded automatically.
				</p>
				<ul class="space-y-1">
					<li>• Sessions close automatically when their window lapses; late submissions are refused.</li>
					<li>• Every class-rep registration is tagged with the rep's name for lecturer review.</li>
					<li>• Reports export to CSV or print straight to PDF.</li>
				</ul>
				<div class="flex flex-wrap gap-2">
					<Button variant="outline" size="sm" href="/lecturer">
						<ClipboardList class="size-4" /> Set up a session
					</Button>
					<Button variant="outline" size="sm" href="/records">
						<Printer class="size-4" /> Review &amp; export records
					</Button>
				</div>
			</Card.Content>
		</Card.Root>
	</section>

	<section>
		<Card.Root>
			<Card.Header>
				<Card.Title>Developer setup</Card.Title>
				<Card.Description>Local run in four steps.</Card.Description>
			</Card.Header>
			<Card.Content>
				<ol class="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
					<li>Copy <code>.env.example</code> to <code>.env.local</code> and set <code>PUBLIC_CONVEX_URL</code>.</li>
					<li>Run <code>pnpm install</code>, then <code>pnpm exec convex dev</code> to push the schema and seed the admin password.</li>
					<li>Open <strong>Lecturer tools</strong>, unlock with <code>admin123</code>, and change the password in Settings.</li>
					<li>Create a term → course → roster, then start your first session.</li>
				</ol>
			</Card.Content>
		</Card.Root>
	</section>
</div>
