<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Toaster } from '$lib/components/ui/sonner';
	import {
		BarChart3,
		Info,
		ScanLine,
		Settings,
		Settings2
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
	 * A student's own pages are deliberately **not** here. They used to be a
	 * six-pill row in this bar, which made the top of every page read as a tab
	 * strip and buried the one control a student actually opens in a lecture.
	 * They now live in an in-page strip (`StudentNav`, from `$lib/lams/nav`) at
	 * the top of the student pages. Lecturers get the same treatment: their
	 * section links live in an in-page strip (`LecturerNav`) on the lecturer
	 * pages, because on a phone this bar has no room for five pills.
	 *
	 * Concretely: below `sm` this bar shows only the logo and the sign-in
	 * state — a single row, nothing scrollable — and the page body carries the
	 * navigation for both roles. On `sm` and up the bar also shows the pill
	 * row, which scrolls internally (`overflow-x-auto` inside its own box, so
	 * it can never widen the page itself).
	 *
	 * Icons are for scanning the row at a glance and are dropped below `sm`,
	 * where the labels alone are tight enough on width.
	 */
	const nav = $derived.by(() => {
		const how = { href: '/how-it-works', label: 'How it works', icon: Info };
		if (!me) return [how];
		if (me.kind === 'staff') {
			const isAdmin = (me as { isAdmin?: boolean }).isAdmin === true || me.role === 'admin';
			if (isAdmin) {
				return [
					{ href: '/admin', label: 'Admin', icon: Settings },
					{ href: '/manage', label: 'Set up', icon: Settings2 },
					{ href: '/scan', label: 'Take attendance', icon: ScanLine },
					{ href: '/records', label: 'Records', icon: BarChart3 },
					how,
					{ href: '/settings', label: 'Settings', icon: Settings }
				];
			}
			return [
				{ href: '/manage', label: 'Set up', icon: Settings2 },
				{ href: '/scan', label: 'Take attendance', icon: ScanLine },
				{ href: '/records', label: 'Records', icon: BarChart3 },
				how,
				{ href: '/settings', label: 'Settings', icon: Settings }
			];
		}
		// A student or a class rep. A rep keeps the station tool here because it
		// is a different job from their own attendance and has nowhere else to
		// live; everything that is *their* record moved into the page.
		return me.role === 'rep'
			? [{ href: '/scan', label: 'Take attendance', icon: ScanLine }, how]
			: [how];
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
		<div class="mx-auto flex max-w-3xl items-center gap-x-3 gap-y-2 px-4 py-2.5">
			<a href={homeHref} class="flex shrink-0 items-center gap-3" aria-label="LAMS home">
				<img src="/lams-logo.png" alt="" class="size-10 rounded-lg" />
				<span class="leading-tight">
					<span class="block text-lg font-extrabold tracking-tight text-lams-navy">LAMS</span>
					<span class="hidden text-xs text-muted-foreground sm:block">
						Lecture Attendance Monitoring System
					</span>
				</span>
			</a>

			<div class="flex min-w-0 flex-1 items-center justify-end gap-2">
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
					<!--
						Desktop only. On a phone this pill row is hidden and the
						page body carries the navigation instead (`StudentNav` /
						`LecturerNav`), so the header stays a single row with
						nothing scrollable in it. The row keeps `overflow-x-auto`
						for the lecturer's five pills, which are wider than the
						space left of the auth button — but that scroll is
						contained in this box (`min-w-0` + `max-w-full`) and can
						never widen the page itself.
					-->
					<div class="relative hidden min-w-0 max-w-full flex-1 sm:block">
						<nav
							aria-label="Main"
							class="nav-scroll flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-1"
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
						{#if nav.length > 2}
							<!-- Fades the right edge so a scrollable row looks scrollable. -->
							<div
								class="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent"
								aria-hidden="true"
							></div>
						{/if}
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
	<main class="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col gap-6 px-4 py-8">{@render children()}</main>
	<footer class="print-hide border-t border-border">
		<div
			class="mx-auto flex max-w-3xl flex-col items-center gap-1 px-4 py-5 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between sm:text-left"
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
