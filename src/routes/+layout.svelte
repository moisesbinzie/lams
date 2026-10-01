<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';

	let { children } = $props();

	const nav = [
		{ href: '/', label: 'Home' },
		{ href: '/lecturer', label: 'Lecturer tools' },
		{ href: '/records', label: 'Records review' }
	];

	const path = $derived(page.url.pathname);
	function navClass(href: string): string {
		return path === href
			? 'bg-lams-navy text-white'
			: 'text-foreground hover:bg-muted';
	}
</script>

<svelte:head>
	<title>LAMS — Lecture Attendance Monitoring System</title>
	<meta
		name="description"
		content="QR + GPS lecture attendance. Students scan and go; the system records time, location and status automatically. Attend • Track • Succeed."
	/>
	<link rel="icon" href="/lams-mark.png" />
	<link rel="apple-touch-icon" href="/lams-logo.png" />
</svelte:head>

<div class="flex min-h-screen flex-col bg-background text-foreground">
	<header class="print-hide sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
			<a href="/" class="flex items-center gap-3" aria-label="LAMS home">
				<img src="/lams-logo.png" alt="LAMS logo" class="size-11 rounded-lg" />
				<span class="leading-tight">
					<span class="block text-lg font-extrabold tracking-tight text-lams-navy">LAMS</span>
					<span class="hidden text-xs text-muted-foreground sm:block">
						Lecture Attendance Monitoring System
					</span>
				</span>
			</a>
			<nav class="flex items-center gap-1 text-sm" aria-label="Main">
				{#each nav as item (item.href)}
					<a
						href={item.href}
						class="rounded-md px-3 py-2 font-medium transition-colors {navClass(item.href)}"
						aria-current={path === item.href ? 'page' : undefined}
					>
						{item.label}
					</a>
				{/each}
			</nav>
		</div>
	</header>
	<main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{@render children()}</main>
	<footer class="print-hide border-t border-border">
		<div
			class="mx-auto flex max-w-6xl flex-col items-center gap-1 px-4 py-5 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between sm:text-left"
		>
			<p class="font-semibold text-lams-navy">Attend • Track • Succeed</p>
			<p>Students scan and go — time, location, distance and status are recorded automatically.</p>
		</div>
	</footer>
</div>

