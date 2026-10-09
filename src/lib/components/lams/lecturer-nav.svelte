<script lang="ts">
	import { page } from '$app/state';
	import { cn } from '$lib/utils';
	import { ADMIN_NAV, LECTURER_NAV } from '$lib/lams/nav';
	import { sessionMe } from '$lib/lams/session.svelte';

	/**
	 * The lecturer's navigation, rendered inside the page rather than only in
	 * the top bar.
	 *
	 * Same contract as `student-nav.svelte`: a `<nav>` of real links (these
	 * navigate to separate pages, so each one is a link with `aria-current`
	 * marking position), borrowing only the tab *look*. The row wraps instead
	 * of scrolling, so a phone never grows a page-level horizontal scrollbar
	 * because of it. Below `sm` the labels are dropped and the icons carry it,
	 * matching how the student strip behaves.
	 *
	 * The top bar keeps these same destinations on `sm` and up; on a phone the
	 * bar shows only the logo and the sign-in state, and this strip is the
	 * navigation.
	 */
	let { class: className = '' }: { class?: string } = $props();

	const path = $derived(page.url.pathname);
	const me = $derived(sessionMe());
	const items = $derived(
		me?.kind === 'staff' && (me.isAdmin === true || me.role === 'admin') ? ADMIN_NAV : LECTURER_NAV
	);

	function isActive(href: string): boolean {
		return path === href || path.startsWith(`${href}/`);
	}
</script>

<nav aria-label="Lecturer console" class={cn('py-0.5', className)}>
	<ul class="flex max-w-full flex-wrap items-center gap-0.5 rounded-3xl bg-muted p-1">
		{#each items as item (item.href)}
			{@const active = isActive(item.href)}
			<li class="shrink-0">
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					aria-label={item.label}
					title={item.label}
					class={cn(
						'flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
						active
							? 'bg-background text-lams-navy shadow-sm'
							: 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
					)}
				>
					<item.icon class="size-4 shrink-0" aria-hidden="true" />
					<span class="hidden sm:inline">{item.label}</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>
