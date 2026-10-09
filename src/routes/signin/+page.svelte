<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import { beginSession, ensureSession, sessionMe, sessionStatus } from '$lib/lams/session.svelte';
	import { getDeviceId } from '$lib/lams/auth';
		import { pendingScanTarget } from '$lib/lams/station';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { GraduationCap, TriangleAlert, UserRound } from '@lucide/svelte';
	import { reportError } from '$lib/lams/notify.svelte';
		import { toast } from 'svelte-sonner';

	/**
	 * Two audiences, two doors. Lecturers use a username and password; students
	 * and class reps use a registration number and a PIN they chose. Keeping
	 * them apart means a student who guesses a registration number cannot reach
	 * a lecturer account, and vice versa.
	 */
	type Mode = 'choose' | 'staff' | 'person' | 'activate';

	let mode = $state<Mode>('choose');
	let regNumber = $state('');
	let studentId = $state('');
	let pin = $state('');
	let confirmPin = $state('');
	let username = $state('');
	let password = $state('');
	let busy = $state(false);
	let loadError = $state('');
	let checking = $state(true);

		/**
		 * A student who scanned the station while signed out has a scan waiting. They
		 * are only ever one step from a record, so finishing sign-in takes them
		 * straight back to the lecture rather than dumping them on their home page.
		 */
		function afterSignIn(): string {
			return pendingScanTarget() ?? '/home';
		}

	onMount(async () => {
		// Reuse the shared session check instead of querying again: if the
		// visitor is already signed in, send them straight to their console.
		await ensureSession();
		if (sessionStatus() === 'authed') {
			const who = sessionMe();
			if (!who) {
				await goto('/home');
				return;
			}
			if (who.kind === 'staff') {
				const isAdmin = (who as { isAdmin?: boolean }).isAdmin === true || who.role === 'admin';
				await goto(isAdmin ? '/admin' : '/manage');
				return;
			}
			await goto('/home');
			return;
		}
		checking = false;
		// A failed check must not sign the visitor out (the token stays), but
		// say plainly why the form might not work until they retry.
		if (sessionStatus() === 'unavailable') {
			loadError = 'Could not reach the server to check your sign-in. Check your connection and try again.';
		}
	});

	function resetMessages() {
		pin = '';
		confirmPin = '';
		password = '';
	}

	async function staffSignIn(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const client = requireConvexClient();
			// Idempotent: creates the default admin account on first ever run.
			await client.mutation(api.staff.ensureSeed, {});
			const res = await client.mutation(api.staff.login, {
				username: username.trim(),
				password
			});
			// A refused sign-in arrives as a message rather than a thrown error:
			// wrong details are an ordinary event, and logging them as server
			// faults buried the failures that are real. The wording is the
			// server's, so it still says exactly what is wrong.
			if (!res.ok) {
				toast.error(res.message);
				return;
			}
			// Record the token in the shared session so the navbar is already
			// signed in when the target page renders. Admins land on the admin
			// console; lecturers land on their (scoped) console.
			await beginSession(res.token);
			const who = sessionMe();
			const isAdmin =
				(res as { isAdmin?: boolean }).isAdmin === true ||
				(res as { role?: string }).role === 'admin' ||
				(who?.kind === 'staff' &&
					((who as { isAdmin?: boolean }).isAdmin === true || who.role === 'admin'));
			await goto(isAdmin ? '/admin' : '/manage');
		} catch (err) {
			reportError(err, 'Could not sign you in.');
		} finally {
			busy = false;
		}
	}

	async function personSignIn(e: SubmitEvent) {
		e.preventDefault();
		if (!regNumber.trim()) {
			toast.error('Enter your registration number.');
			return;
		}
		if (!/^\d{4,8}$/.test(pin.trim())) {
			toast.error('Your PIN must be 4 to 8 digits.');
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			const res = await client.mutation(api.people.login, {
				regNumber: regNumber.trim(),
				pin: pin.trim(),
				deviceId: getDeviceId()
			});
			// Same contract as the lecturer door: a refusal is a message, not a
			// thrown error, because a mistyped PIN is not a fault.
			if (!res.ok) {
				toast.error(res.message);
				return;
			}
			// Record the token in the shared session so the navbar is already
			// signed in when the target page renders.
			await beginSession(res.token);
			await goto(afterSignIn());
		} catch (err) {
			reportError(err, 'Could not sign you in.');
		} finally {
			busy = false;
		}
	}

	async function activate(e: SubmitEvent) {
		e.preventDefault();
		if (pin !== confirmPin) {
			toast.error('The two PINs do not match.');
			return;
		}
		busy = true;
		try {
			const client = requireConvexClient();
			const activated = await client.mutation(api.people.activate, {
				regNumber: regNumber.trim(),
				studentId: studentId.trim(),
				pin: pin.trim()
			});
			// Wrong details are answered, not thrown, so they land here. Staying
			// on the form with the server's own sentence is the useful response:
			// the registration number or the student ID is the thing to fix.
			if (!activated.ok) {
				toast.error(activated.message);
				return;
			}
			// Straight to sign-in so the new PIN is proven to work.
			mode = 'person';
			const createdPin = pin.trim();
			pin = '';
			confirmPin = '';
			const res = await client.mutation(api.people.login, {
				regNumber: regNumber.trim(),
				pin: createdPin,
				deviceId: getDeviceId()
			});
			// A refusal here is not a mistyped PIN — the PIN was set a moment
			// ago — so it is a failure of the setup itself and is raised as one.
			if (!res.ok) throw new Error(res.message);
			// Record the token in the shared session so the navbar is already
			// signed in when the target page renders.
			await beginSession(res.token);
			await goto(afterSignIn());
		} catch (err) {
			reportError(err, 'Could not set up your account.');
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-col gap-6">
	<div class="flex flex-col items-center gap-2 pt-4 text-center">
		<img src="/lams-logo.png" alt="LAMS" class="size-16 rounded-xl" />
		<h1 class="text-2xl font-bold text-lams-navy">
			{mode === 'staff' ? 'Lecturer sign in' : mode === 'activate' ? 'Set up your account' : 'Sign in to LAMS'}
		</h1>
		<p class="text-sm text-muted-foreground">
			{#if mode === 'staff'}
				For lecturers. Use the username and password you were given.
			{:else if mode === 'activate'}
				Your class rep or lecturer has already added you. Confirm your details and choose a PIN.
			{:else if mode === 'person'}
				Use your registration number and PIN.
			{:else}
				Choose how you are signing in.
			{/if}
		</p>
	</div>

	{#if loadError}
		<!--
			Kept inline rather than toasted, deliberately. This is not a failure of
			one action: it means the server could not be reached at all, so every
			sign-in attempt below is about to fail too. A toast would dismiss itself
			while the visitor is still reading the form and wondering why it does
			nothing. It needs to sit on the page until they retry.
		-->
		<p class="flex items-start gap-2 text-sm text-red-700" role="alert">
			<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<span>{loadError}</span>
		</p>
	{/if}

	{#if checking}
		<p class="text-center text-sm text-muted-foreground">Checking…</p>
	{:else if mode === 'choose'}
		<div class="flex flex-col gap-3">
			<Card.Root class="transition-shadow hover:shadow-md">
				<Card.Content class="flex items-center gap-4 pt-6">
					<span class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-lams-navy text-white">
						<GraduationCap class="size-6" aria-hidden="true" />
					</span>
					<div class="flex-1">
						<p class="font-semibold">I am a lecturer</p>
						<p class="text-sm text-muted-foreground">Set up classes, subjects and timetables.</p>
					</div>
					<Button onclick={() => { mode = 'staff'; resetMessages(); }}>Continue</Button>
				</Card.Content>
			</Card.Root>

			<Card.Root class="transition-shadow hover:shadow-md">
				<Card.Content class="flex items-center gap-4 pt-6">
					<span class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-lams-green text-white">
						<UserRound class="size-6" aria-hidden="true" />
					</span>
					<div class="flex-1">
						<p class="font-semibold">I am a student or class rep</p>
						<p class="text-sm text-muted-foreground">Show your code and check your attendance.</p>
					</div>
					<Button variant="secondary" onclick={() => { mode = 'person'; resetMessages(); }}>
						Continue
					</Button>
				</Card.Content>
			</Card.Root>
		</div>
	{:else}
		<Card.Root>
			<Card.Content class="pt-6">
				{#if mode === 'staff'}
					<form class="flex flex-col gap-6" onsubmit={staffSignIn}>
						<div class="flex flex-col gap-1.5">
							<Label for="un">Username</Label>
							<Input id="un" bind:value={username} autocomplete="username" required />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="pw">Password</Label>
							<Input
								id="pw"
								type="password"
								bind:value={password}
								autocomplete="current-password"
								required
							/>
						</div>
						<Button type="submit" size="lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
						<p class="text-xs text-muted-foreground">
							First time here? Sign in with the username and password you were given, then change the
							password from your settings.
						</p>
					</form>
				{:else if mode === 'person'}
					<form class="flex flex-col gap-6" onsubmit={personSignIn}>
						<div class="flex flex-col gap-1.5">
							<Label for="reg">Registration number</Label>
							<Input id="reg" bind:value={regNumber} placeholder="e.g. BIT/2024/0123" required />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="pin">PIN</Label>
							<Input id="pin" type="password" inputmode="numeric" bind:value={pin} placeholder="4 to 8 digits" required />
						</div>
						<Button type="submit" size="lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
					</form>
				{:else}
					<form class="flex flex-col gap-6" onsubmit={activate}>
						<div class="flex flex-col gap-1.5">
							<Label for="areg">Registration number</Label>
							<Input id="areg" bind:value={regNumber} placeholder="e.g. BIT/2024/0123" required />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="sid">Student ID</Label>
							<Input id="sid" bind:value={studentId} placeholder="e.g. 2024-0123" required />
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="apin">Choose a PIN</Label>
							<Input id="apin" type="password" inputmode="numeric" bind:value={pin} placeholder="4 to 8 digits" required />
							<p class="text-xs text-muted-foreground">
								Use a PIN you will remember. If you forget it, your class rep or lecturer can reset it.
							</p>
						</div>
						<div class="flex flex-col gap-1.5">
							<Label for="cpin">Type it again</Label>
							<Input id="cpin" type="password" inputmode="numeric" bind:value={confirmPin} required />
						</div>
						<Button type="submit" size="lg" disabled={busy}>{busy ? 'Setting up…' : 'Set up and sign in'}</Button>
					</form>
				{/if}

				<!--
					"First time here?" was a link-sized button sharing a row with
					"Back", which is where a brand-new student has to look for the
					one control that gets them into the system at all. It is now a
					full-width button of its own, sitting above the way back so the
					two are not read as a pair of equally-weighted links.
				-->
				{#if mode === 'person'}
					<Button
						variant="outline"
						size="lg"
						class="mt-4 w-full border-lams-green/50 text-lams-navy"
						onclick={() => { mode = 'activate'; resetMessages(); }}
					>
						First time here? Set up your account
					</Button>
				{/if}

				<div class="mt-3 border-t border-border pt-3 text-center">
					<Button
						variant="link"
						class="h-auto p-0"
						onclick={() => { mode = 'choose'; resetMessages(); }}
					>
						Back
					</Button>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>