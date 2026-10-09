<script lang="ts">
	import { GraduationCap, ShieldCheck, UserRound, UsersRound } from '@lucide/svelte';
	import { sessionMe } from '$lib/lams/session.svelte';
	import { cn } from '$lib/utils';

	/**
	 * Global account-type indicator. Rendered once in the root layout above
	 * every page, so a signed-in user always sees which account they hold:
	 * Admin, Lecturer, Class rep or Student. Each type has its own icon,
	 * label and tint — color is never the only signal, the words are there.
	 */

	const me = $derived(sessionMe());

	const info = $derived.by(() => {
		if (!me) return null;
		if (me.kind === 'staff') {
			const isAdmin = (me as { isAdmin?: boolean }).isAdmin === true || me.role === 'admin';
			if (isAdmin) {
				return {
					key: 'admin',
					icon: ShieldCheck,
					label: 'Admin account',
					detail: 'Full access — lecturers, subjects and assignments',
					name: me.username,
					box: 'border-amber-300 bg-amber-50 text-amber-950',
					pill: 'bg-amber-600 text-white'
				} as const;
			}
			return {
				key: 'lecturer',
				icon: GraduationCap,
				label: 'Lecturer account',
				detail: 'Assigned subjects only',
				name: (me as { username: string }).username,
				box: 'border-lams-navy/25 bg-lams-navy/5 text-lams-navy',
				pill: 'bg-lams-navy text-white'
			} as const;
		}
		if (me.role === 'rep') {
			return {
				key: 'rep',
				icon: UsersRound,
				label: 'Class rep account',
				detail: 'Take attendance for your classes',
				name: me.fullName,
				box: 'border-lams-green/30 bg-lams-green/5 text-lams-navy',
				pill: 'bg-lams-green text-white'
			} as const;
		}
		return {
			key: 'student',
			icon: UserRound,
			label: 'Student account',
			detail: 'Your own attendance only',
			name: me.fullName,
			box: 'border-border bg-muted/60 text-foreground',
			pill: 'bg-secondary text-secondary-foreground'
		} as const;
	});
</script>

{#if info}
	{@const Icon = info.icon}
	<p
		role="status"
		aria-label={`Signed in with a ${info.label.toLowerCase()}`}
		class={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-xs', info.box)}
	>
		<span class={cn('flex size-6 shrink-0 items-center justify-center rounded-full', info.pill)}>
			<Icon class="size-3.5" aria-hidden="true" />
		</span>
		<span class="font-semibold">{info.label}</span>
		<span class="hidden truncate text-muted-foreground min-[420px]:inline sm:inline">
			{info.name} · {info.detail}
		</span>
		<span class="truncate text-muted-foreground min-[420px]:hidden">{info.name}</span>
	</p>
{/if}
