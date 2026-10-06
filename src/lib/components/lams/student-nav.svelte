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
	 * The row scrolls sideways instead of wrapping on a phone. Five labels wrap
	 * to three lines at 360px, which pushes the actual page content below the
	 * fold, and a student opening this in a hall wants the content, not the menu.
	 */
	let { class: className = '' }: { class?: string } = $props();

	const path = $derived(page.url.pathname);

	function isActive(href: string): boolean {
		return path === href || path.startsWith(`${href}/`);
	}
</script>

<nav aria-label="My LAMS" class={cn('min-w-0 max-w-full overflow-x-auto', className)}>
	<ul
		class="flex w-fit min-w-full items-center gap-1 rounded-full bg-muted p-1 sm:min-w-0"
	>
		{#each STUDENT_NAV as item (item.href)}
			{@const active = isActive(item.href)}
			<li class="shrink-0">
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					class={cn(
						'flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
						active
							? 'bg-background text-lams-navy shadow-sm'
							: 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
					)}
				>
					<item.icon class="size-4 shrink-0" aria-hidden="true" />
					<span class="flex flex-col leading-tight">
						{item.label}
						<span class="hidden text-[11px] font-normal opacity-70 lg:block">{item.hint}</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>
