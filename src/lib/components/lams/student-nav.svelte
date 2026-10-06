<script lang="ts">
	import { page } from '$app/state';
	import { cn } from '$lib/utils';
	import { STUDENT_NAV } from '$lib/lams/nav';

	/**
	 * The student's navigation, rendered inside the page rather than in the top
	 * bar.
	 *
	 * It is a `<nav>` of real links, not a bits-ui `Tabs.Root`: these navigate to
	 * separate pages, so each one has to be a link the browser and a screen
	 * reader understand as a destination, with `aria-current` marking where the
	 * reader already is. A tab widget would model "one page, several panels",
	 * which is not what this is — it just borrows the tab *look*, because that is
	 * the shape people already read as "sections of one area".
	 *
	 * Three failed attempts are worth recording so they are not repeated:
	 *
	 *   - `w-fit` centred: clipped the last label on the narrow student pages
	 *     (`/scanner` is `max-w-md`) with no sign it could scroll.
	 *   - full width with `flex-1 min-w-0` pills: forced five labels into a
	 *     448 px row, so each pill shrank narrower than its own text and the
	 *     labels ran out past the rounded backgrounds.
	 *   - a single non-wrapping row: correct at full width, but it overhung the
	 *     `max-w-md` column on `/scanner` and `/a/[sessionId]`.
	 *
	 * The row is therefore sized by its content and wraps when the column is too
	 * narrow, which is what a page that deliberately constrains its own width
	 * should do rather than being overrun. Below `sm` the labels are dropped
	 * altogether and the icons carry it, matching how the top bar behaves.
	 */
	let { class: className = '' }: { class?: string } = $props();

	const path = $derived(page.url.pathname);

	function isActive(href: string): boolean {
		return path === href || path.startsWith(`${href}/`);
	}
</script>

<nav aria-label="My LAMS" class={cn('py-0.5', className)}>
	<ul class="flex max-w-full flex-wrap items-center gap-0.5 rounded-3xl bg-muted p-1">
		{#each STUDENT_NAV as item (item.href)}
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
