<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { ClassRow, PersonRow } from '$lib/lams/types';
	import { reportError } from '$lib/lams/notify.svelte';

	/**
	 * Edit a person's editable details: name, identifiers and their classes.
	 * A student may sit in several classes (the repeating-subject case), so
	 * membership is a checkbox list, not a single pick. Identity changes are
	 * unusual — the server rejects a reg number another person already holds.
	 */
	let {
		person,
		classes,
		token,
		open = $bindable(false),
		onsaved
	}: {
		person: PersonRow | null;
		classes: ClassRow[];
		token: string;
		open?: boolean;
		onsaved?: () => void | Promise<void>;
	} = $props();

	let fullName = $state('');
	let regNumber = $state('');
	let studentId = $state('');
	let pickedClassIds = $state<string[]>([]);
	let busy = $state(false);

	$effect(() => {
		if (open && person) {
			fullName = person.fullName;
			regNumber = person.regNumber;
			studentId = person.studentId;
			pickedClassIds = [...person.classIds];
		}
	});

	function toggleClass(classId: string) {
		pickedClassIds = pickedClassIds.includes(classId)
			? pickedClassIds.filter((id) => id !== classId)
			: [...pickedClassIds, classId];
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (!person) return;
		busy = true;
		try {
			const client = requireConvexClient();
			await client.mutation(api.people.updatePerson, {
				token,
				personId: person._id as never,
				fullName: fullName.trim(),
				regNumber: regNumber.trim(),
				studentId: studentId.trim(),
				classIds: pickedClassIds as never[]
			});
			open = false;
			await onsaved?.();
		} catch (err) {
			reportError(err, 'Could not save the changes.');
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Edit {person?.fullName ?? 'student'}</Dialog.Title>
			<Dialog.Description>
				Fix a typo, or tick every class the student sits in — for example their own class plus a
				junior class for a subject they are repeating.
			</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-3" onsubmit={save}>
			<div class="flex flex-col gap-1">
				<Label for="pen">Full name</Label>
				<Input id="pen" bind:value={fullName} required />
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div class="flex flex-col gap-1">
					<Label for="per">Registration number</Label>
					<Input id="per" bind:value={regNumber} required />
				</div>
				<div class="flex flex-col gap-1">
					<Label for="pes">Student ID</Label>
					<Input id="pes" bind:value={studentId} required />
				</div>
			</div>
			<fieldset class="flex flex-col gap-1">
				<legend class="text-sm font-medium">Classes</legend>
				{#if classes.length === 0}
					<p class="text-sm text-muted-foreground">No classes exist yet.</p>
				{:else}
					<div class="flex flex-col gap-1 rounded-md border border-border p-2">
						{#each classes as c (c._id)}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									class="size-4"
									checked={pickedClassIds.includes(c._id)}
									onchange={() => toggleClass(c._id)}
								/>
								{c.name}
							</label>
						{/each}
					</div>
				{/if}
			</fieldset>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Save changes</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
