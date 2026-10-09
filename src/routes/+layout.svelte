<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Toaster } from '$lib/components/ui/sonner';
	import { Info, ScanLine, House } from '@lucide/svelte';
	import { ADMIN_NAV, LECTURER_NAV } from '$lib/lams/nav';
	import AccountStrip from '$lib/components/lams/account-strip.svelte';
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
	 * Navigation is built from the signed-in role so nobody hunts for tools
	 * they cannot use and nobody sees tools they should not:
	 *
	 *   anon     -> How it works
	 *   admin    -> Admin console, Set up, Take attendance, Records, Settings, How
	 *   lecturer -> Set up, Take attendance, Records, Settings, How
	 *   rep      -> My account, Take attendance, How
	 *   student  -> My account, How
	 *
	 * The header row is visible on all screen sizes and scrolls internally,
	 * so a phone never grows a page-level scrollbar because of it. The page
	 * body keeps its own in-page strip (`StudentNav` / `LecturerNav`) as the
	 * primary section switcher; the header is the global way home plus auth.
	 */
	const nav = $derived.by(() => {
		const how = { href: '/how-it-works', label: 'How it works', icon: Info };
		const dashboard = { href: '/home', label: 'My account', icon: House };
		if (!me) return [how];
		if (me.kind === 'staff') {
			const isAdmin = (me as { isAdmin?: boolean }).isAdmin === true || me.role === 'admin';
			const base = isAdmin ? ADMIN_NAV : LECTURER_NAV;
			return [...base, how];
		}
		// A student or a class rep. A rep keeps the station tool here because it
		// is a different job from their own attendance and has nowhere else to
		// live; everything that is *their* record moved into the page.
		return me.role === 'rep' ? [dashboard, { href: '/scan', label: 'Take attendance', icon: ScanLine }, how] : [dashboard, how];
	});

	const roleLabel = $derived.by(() => {
		if (!me) return null;
		if (me.kind === 'staff') {
			const isAdmin = (me as { isAdmin?: boolean }).isAdmin === true || me.role === 'admin';
			return isAdmin ? 'Admin' : 'Lecturer';
		}
		return me.role === 'rep' ? 'Class rep' : 'Student';
	});

	/** Color-coded account badge so the account type reads at a glance. */
	const roleBadgeClass = $derived.by(() => {
		if (!me) return '';
		if (me.kind === 'staff') {
			const isAdmin = (me as { isAdmin?: boolean }).isAdmin === true || me.role === 'admin';
			return isAdmin ? 'bg-amber-600 text-white' : 'bg-lams-navy text-white';
		}
		return me.role === 'rep' ? 'bg-lams-green text-white' : '';
	});

	const displayName = $derived.by(() => {
		if (!me) return '';
		if (me.kind === 'staff') return me.username;
		return me.fullName;
	});

	const homeHref = $derived.by(() => {
		if (!me) return '/';
		if (me.kind === 'person') return '/home';
		const isAdmin = (me as { isAdmin?: boolean }).isAdmin === true || me.role === 'admin';
		return isAdmin ? '/admin' : '/manage';
	});

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
		<div class="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-2.5">
			<div class="flex items-center gap-x-3 gap-y-2">
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
					{:else if me}
						<span class="flex min-w-0 items-center gap-2">
							<span
								class="flex size-8 shrink-0 items-center justify-center rounded-full bg-lams-navy text-sm font-bold text-white"
								aria-hidden="true"
							>
								{(displayName || 'L').trim().charAt(0).toUpperCase()}
							</span>
							<span class="hidden min-w-0 flex-col leading-tight min-[400px]:flex">
								<span class="truncate text-sm font-semibold">{displayName}</span>
								{#if roleLabel}
									<Badge class={`w-fit px-1.5 py-0 text-[10px] ${roleBadgeClass}`}>{roleLabel}</Badge>
								{/if}
							</span>
							{#if roleLabel}
								<Badge class={`shrink-0 min-[400px]:hidden ${roleBadgeClass}`}>{roleLabel}</Badge>
							{/if}
							<Button variant="outline" size="sm" class="shrink-0" onclick={signOut}>Sign out</Button>
						</span>
					{:else}
						<Button size="sm" class="shrink-0" href="/signin">Sign in</Button>
					{/if}
				</div>
			</div>

			{#if status !== 'checking' && status !== 'unavailable'}
				<!--
					Global nav, visible on all sizes. Scrolls internally so it can
					never widen the page. The page body keeps its own section
					strip (`StudentNav` / `LecturerNav`); this row is the global
					way between areas plus auth state above.
				-->
				<div class="relative min-w-0 max-w-full">
					<nav
						aria-label="Main"
						class="nav-scroll flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-1"
					>
						{#each nav as item (item.href)}
							<a
								href={item.href}
								class="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors {isActive(
									item.href
								)
									? 'bg-background text-lams-navy shadow-sm'
									: 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}"
								aria-current={isActive(item.href) ? 'page' : undefined}
							>
								<item.icon class="size-4 shrink-0" aria-hidden="true" />
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
			{/if}
		</div>
	</header>
	<main class="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col gap-6 px-4 py-8">
		{#if me && path !== '/signin'}
			<AccountStrip />
		{/if}
		{@render children()}
	</main>
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
