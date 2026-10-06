<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Toaster } from '$lib/components/ui/sonner';
	import {
		BarChart3,
		BookOpen,
		CalendarDays,
		Info,
		ScanLine,
		Settings,
		Settings2,
		UserRound
	} from '@lucide/svelte';
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
	 * Explaining the system is useful before anyone has an account, so
	 * "How it works" is the one link every visitor gets.
	 *
	 * Icons are for scanning the row at a glance and are dropped below `sm`,
	 * where the labels alone are tight enough on width.
	 */
	const nav = $derived.by(() => {
		const how = { href: '/how-it-works', label: 'How it works', icon: Info };
		if (!me) return [how];
		if (me.role === 'lecturer') {
			return [
				{ href: '/manage', label: 'Set up', icon: Settings2 },
				{ href: '/scan', label: 'Take attendance', icon: ScanLine },
				{ href: '/records', label: 'Records', icon: BarChart3 },
				how,
				{ href: '/settings', label: 'Settings', icon: Settings }
			];
		}
		if (me.role === 'rep') {
			return [
				{ href: '/home', label: 'My account', icon: UserRound },
				{ href: '/timetable', label: 'Timetable', icon: CalendarDays },
				{ href: '/scanner', label: 'Scan attendance', icon: ScanLine },
				{ href: '/scan', label: 'Take attendance', icon: ScanLine },
				how,
				{ href: '/courses', label: 'My subjects', icon: BookOpen }
			];
		}
			return [
				{ href: '/home', label: 'My account', icon: UserRound },
				{ href: '/timetable', label: 'Timetable', icon: CalendarDays },
				{ href: '/scanner', label: 'Scan attendance', icon: ScanLine },
				how,
				{ href: '/courses', label: 'My subjects', icon: BookOpen },
				{ href: '/attendance', label: 'My attendance', icon: BarChart3 }
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
		<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
			<a href={homeHref} class="flex shrink-0 items-center gap-3" aria-label="LAMS home">
				<img src="/lams-logo.png" alt="" class="size-10 rounded-lg" />
				<span class="leading-tight">
					<span class="block text-lg font-extrabold tracking-tight text-lams-navy">LAMS</span>
					<span class="hidden text-xs text-muted-foreground sm:block">
						Lecture Attendance Monitoring System
					</span>
				</span>
			</a>

			<div class="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto sm:flex-1 sm:justify-end">
				{#if status === 'checking' || status === 'unavailable'}
					<span class="flex flex-1 items-center gap-2 sm:flex-none">
						<span class="h-9 w-full animate-pulse rounded-full bg-muted sm:w-36" aria-hidden="true"
						></span>
						{#if status === 'unavailable'}
							<Button variant="ghost" size="sm" onclick={() => void refreshSession()}>
								Retry
							</Button>
						{/if}
					</span>
				{:else}
					<!-- The links scroll on narrow screens; the auth button sits outside
					     that container so Sign out can never scroll away from the top. -->
					<div class="relative min-w-0 flex-1 sm:flex-none">
						<nav
							aria-label="Main"
							class="nav-scroll flex items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-1"
						>
							{#each nav as item (item.href)}
								<a
									href={item.href}
									class="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors {isActive(
										item.href
									)
										? 'bg-background text-lams-navy shadow-sm'
										: 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
									aria-current={isActive(item.href) ? 'page' : undefined}
								>
									<item.icon class="hidden size-4 shrink-0 sm:block" aria-hidden="true" />
									{item.label}
								</a>
							{/each}
						</nav>
						<!-- Fades the right edge so a scrollable row looks scrollable. -->
						<div
							class="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent sm:hidden"
							aria-hidden="true"
						></div>
					</div>

					{#if me}
						<Button variant="outline" size="sm" class="shrink-0" onclick={signOut}>Sign out</Button>
					{:else}
						<Button size="sm" class="shrink-0" href="/signin">Sign in</Button>
					{/if}
				{/if}
			</div>
		</div>
	</header>
	<main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{@render children()}</main>
	<footer class="print-hide border-t border-border">
		<div
			class="mx-auto flex max-w-6xl flex-col items-center gap-1 px-4 py-5 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between sm:text-left"
		>
			<p class="font-semibold text-lams-navy">Attend • Track • Succeed</p>
			<p>Scan the screen at the front of the hall, and the rest is recorded for you.</p>
			<a href="/how-it-works" class="underline underline-offset-2 hover:text-foreground"
				>How it works</a
			>
		</div>
	</footer>
	<!--
		The one mount point for every toast in the app. It was missing, which made
		every `reportError` / `toast.*` call a no-op: failures had nowhere to
		render. Kept at the root so a toast survives navigation — a student sent
		from a scan to `/courses` still sees why.
	-->
	<Toaster position="top-center" richColors closeButton />
</div>
