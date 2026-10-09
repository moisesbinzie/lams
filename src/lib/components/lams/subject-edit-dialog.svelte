<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import type { StaffRow, Subject } from '$lib/lams/types';
	import { reportError } from '$lib/lams/notify.svelte';

	/** Edit a catalogue subject: title, weekly hours and the lecturer of record. */
	let {
		subject,
		token,
		open = $bindable(false),
		onsaved
	}: {
		subject: Subject | null;
		token: string;
		open?: boolean;
		onsaved?: () => void | Promise<void>;
	} = $props();

	let title = $state('');
	let hours = $state('');
	let lecturerId = $state('');
	let staff = $state<StaffRow[]>([]);
	let busy = $state(false);

	/**
	 * bits-ui refuses an empty string as a select item's value, so "no lecturer
	 * of record" travels through the menu as a sentinel and is mapped back to
	 * the empty id at both edges.
	 */
	const NOT_SET = 'not-set';

	$effect(() => {
		if (open && subject) {
			title = subject.title;
			hours = subject.hoursPerWeek ? String(subject.hoursPerWeek) : '';
			lecturerId = subject.lecturerId ?? '';
			void loadStaff();
		}
	});

	async function loadStaff() {
		try {
			const client = requireConvexClient();
			staff = (await client.query(api.staff.listStaff, { token })) as unknown as StaffRow[];
		} catch {
			// The picker simply stays empty; the subject can still be renamed.
			staff = [];
		}
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!subject) return;
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.academics.updateSubject, {
				token,
				id: subject._id as never,
				title: title.trim(),
				hoursPerWeek: Number(hours) || undefined,
				lecturerId: (lecturerId || undefined) as never
			});
			open = false;
			await onsaved?.();
		} catch (err) {
			reportError(err, 'Could not save the subject.');
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Edit {subject?.code}</Dialog.Title>
			<Dialog.Description>The code is fixed once created; everything else can change.</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-3" onsubmit={save}>
			<div class="flex flex-col gap-1">
				<Label for="set">Title</Label>
				<Input id="set" bind:value={title} required />
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div class="flex flex-col gap-1">
					<Label for="seh">Hours per week</Label>
					<Input id="seh" type="number" min="1" max="20" bind:value={hours} />
				</div>
				<div class="flex flex-col gap-1">
					<Label for="sel">Lecturer of record</Label>
					<Select.Root
						type="single"
						value={lecturerId || NOT_SET}
						onValueChange={(v) => {
							lecturerId = v === NOT_SET ? '' : (v ?? '');
						}}
					>
						<Select.Trigger id="sel" class="w-full">
							<Select.Value placeholder="Not set" />
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								<Select.Item value={NOT_SET} label="Not set">Not set</Select.Item>
								{#each staff as s (s._id)}
									<Select.Item value={s._id} label={`${s.fullName} (${s.username})`}>
										{s.fullName} ({s.username})
									</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				</div>
			</div>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Save changes</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
