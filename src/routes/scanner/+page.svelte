<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import QrCameraScanner from '$lib/components/lams/qr-camera-scanner.svelte';
	import type { ScannedStation } from '$lib/lams/station';
	import StudentNav from '$lib/components/lams/student-nav.svelte';

	/**
	 * The student's way into a lecture when the phone's own camera app will not
	 * do the job. Reading the station QR here produces exactly the same URL the
	 * camera app would have opened, so the scan that follows is the ordinary
	 * `/a/[sessionId]` flow rather than a second way of recording attendance.
	 */
	let token = getToken();

	onMount(() => {
		if (!token) void goto('/signin');
	});

	function openLecture(station: ScannedStation) {
		void goto(`/a/${station.sessionId}?c=${station.code}`);
	}
</script>

	<StudentNav />
	<!--
		The page itself is the shared student width so the strip and the heading
		line up across tabs, but the content stays in a narrow centred column: the
		camera viewfinder is a square, and at the full page width it would be
		~740 px tall on a desktop, pushing the instructions below the fold.
	-->
	<div class="mx-auto flex w-full max-w-md flex-col gap-6">
		<div class="text-center">
			<h1 class="text-2xl font-bold text-lams-navy">Scan attendance</h1>
			<p class="text-sm text-muted-foreground">
				Point your camera at the code on the screen at the front of the hall. Your name, the time and
				how far you were from the screen are recorded for you.
			</p>
		</div>

		<Card.Root>
			<Card.Content class="pt-6">
				{#if token}
					<QrCameraScanner onscanned={openLecture} />
				{:else}
					<div class="flex flex-col items-center gap-3 py-6 text-center">
						<p class="text-sm text-muted-foreground">You need to sign in before you can scan.</p>
						<Button href="/signin">Sign in</Button>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">How this works</Card.Title>
			</Card.Header>
			<Card.Content>
				<ol class="flex flex-col gap-2 text-sm text-muted-foreground">
					<li>
						<strong class="text-foreground">1.</strong> The screen at the front shows a fresh code that
						changes every 10 seconds.
					</li>
					<li>
						<strong class="text-foreground">2.</strong> Hold your phone up to it. You are recorded as
						present the moment it reads.
					</li>
					<li>
						<strong class="text-foreground">3.</strong> Arrive late and it still counts — up to the limit
						your lecturer set.
					</li>
				</ol>
				<p class="mt-3 text-xs text-muted-foreground">
					Your normal camera app does the same job: scanning the screen with it opens this page with the
					code already filled in. Some phone cameras will not open links, which is what this page is for.
				</p>
			</Card.Content>
		</Card.Root>
	</div>
