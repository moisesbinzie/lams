<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import {
		endSession,
		ensureSession,
		refreshSession,
		sessionMe,
		sessionStatus
	} from '$lib/lams/session.svelte';

	let { children } = $props();

	const status = $derived(sessionStatus());
	const me = $derived(sessionMe());
	const path = $derived(page.url.pathname);

	onMount(() => {
		void ensureSession();
	});

	/**
	 * Navigation is built from the signed-in role rather than fixed, so a
	 * student never sees staff tools and a lecturer never hunts for them.
	 * While the session is still being checked the navbar holds a skeleton
	 * instead of the signed-out links, so a signed-in user never sees the
	 * nav flicker through "Home + Sign in" on every load.
	 */
	const nav = $derived.by(() => {
		// Explaining the system is useful before anyone has an account, so this
		// page is the one link every visitor gets regardless of role.
		const how = { href: '/how-it-works', label: 'How it works' };
		if (!me) return [{ href: '/', label: 'Home' }, how];
		if (me.role === 'lecturer') {
			return [
				{ href: '/manage', label: 'Set up' },
				{ href: '/scan', label: 'Take attendance' },
				{ href: '/records', label: 'Records' },
				how,
				{ href: '/settings', label: 'Settings' }
			];
		}
		if (me.role === 'rep') {
			return [
				{ href: '/home', label: 'My account' },
				{ href: '/timetable', label: 'Timetable' },
				{ href: '/scan', label: 'Take attendance' },
				how,
				{ href: '/courses', label: 'My subjects' }
			];
		}
		return [
			{ href: '/home', label: 'My account' },
			{ href: '/timetable', label: 'Timetable' },
			how,
			{ href: '/courses', label: 'My subjects' },
			{ href: '/attendance', label: 'My attendance' }
		];
	});

	const homeHref = $derived(!me ? '/' : me.kind === 'person' ? '/home' : '/manage');

	function isActive(href: string): boolean {
		return path === href || (href !== '/' && path.startsWith(`${href}/`));
	}

	function signOut() {
		endSession();
		void goto('/signin');
	}
</script>

<svelte:head>
	<title>LAMS — Lecture Attendance</title>
	<meta
		name="description"
		content="Lecture attendance made fast and simple. Students scan a QR code on the screen at the front of the hall, and their name, time and distance from the station are recorded automatically. Attend • Track • Succeed."
	/>
	<link rel="icon" href="/lams-mark.png" />
	<link rel="apple-touch-icon" href="/lams-logo.png" />
</svelte:head>

<div class="flex min-h-screen flex-col bg-background text-foreground">
	<header class="print-hide sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
			<a href={homeHref} class="flex items-center gap-3" aria-label="LAMS home">
				<img src="/lams-logo.png" alt="LAMS logo" class="size-11 rounded-lg" />
				<span class="leading-tight">
					<span class="block text-lg font-extrabold tracking-tight text-lams-navy">LAMS</span>
					<span class="hidden text-xs text-muted-foreground sm:block">
						Lecture Attendance Monitoring System
					</span>
				</span>
			</a>
			<nav class="flex w-full items-center gap-1 overflow-x-auto text-sm sm:w-auto" aria-label="Main">
				{#if status === 'checking' || status === 'unavailable'}
					<span class="ml-auto flex items-center gap-2">
						<span class="h-9 w-36 animate-pulse rounded-md bg-muted" aria-hidden="true"></span>
						{#if status === 'unavailable'}
							<Button variant="ghost" size="sm" onclick={() => void refreshSession()}>
								Retry
							</Button>
						{/if}
					</span>
				{:else}
					{#each nav as item (item.href)}
						<a
							href={item.href}
							class="shrink-0 rounded-md px-3 py-2 font-medium transition-colors {isActive(item.href)
								? 'bg-lams-navy text-white'
								: 'text-foreground hover:bg-muted'}"
							aria-current={isActive(item.href) ? 'page' : undefined}
						>
							{item.label}
						</a>
					{/each}
					{#if me}
						<Button variant="ghost" size="sm" class="ml-auto shrink-0" onclick={signOut}>Sign out</Button>
					{:else}
						<Button size="sm" class="ml-auto shrink-0" href="/signin">Sign in</Button>
					{/if}
				{/if}
			</nav>
		</div>
	</header>
	<main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{@render children()}</main>
	<footer class="print-hide border-t border-border">
		<div
			class="mx-auto flex max-w-6xl flex-col items-center gap-1 px-4 py-5 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between sm:text-left"
		>
			<p class="font-semibold text-lams-navy">Attend • Track • Succeed</p>
			<p>Scan the screen at the front of the hall, and the rest is recorded for you.</p>
		</div>
	</footer>
</div>
