<script lang="ts">
	import { api } from '../../../convex/_generated/api.js';
	import { requireConvexClient } from '$lib/convexClient';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { ProgramRow, PersonRow } from '$lib/lams/types';
	import { reportError } from '$lib/lams/notify.svelte';

	/**
	 * Edit a person's editable details: name, identifiers and their programs.
	 * A student may sit in several programs (the repeating-course case), so
	 * membership is a checkbox list, not a single pick. Identity changes are
	 * unusual — the server rejects a reg number another person already holds.
	 */
	let {
		person,
		programs,
		token,
		open = $bindable(false),
		onsaved
	}: {
		person: PersonRow | null;
		programs: ProgramRow[];
		token: string;
		open?: boolean;
		onsaved?: () => void | Promise<void>;
	} = $props();

	let fullName = $state('');
	let regNumber = $state('');
	let studentId = $state('');
	let pickedProgramIds = $state<string[]>([]);
	let busy = $state(false);

	$effect(() => {
		if (open && person) {
			fullName = person.fullName;
			regNumber = person.regNumber;
			studentId = person.studentId;
			pickedProgramIds = [...person.programIds];
		}
	});

	function toggleProgram(programId: string) {
		pickedProgramIds = pickedProgramIds.includes(programId)
			? pickedProgramIds.filter((id) => id !== programId)
			: [...pickedProgramIds, programId];
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
				programIds: pickedProgramIds as never[]
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
				Fix a typo, or tick every program the student sits in — for example their own program plus
				another one for a course they are repeating.
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
				<legend class="text-sm font-medium">Programs</legend>
				{#if programs.length === 0}
					<p class="text-sm text-muted-foreground">No programs exist yet.</p>
				{:else}
					<div class="flex flex-col gap-1 rounded-md border border-border p-2">
						{#each programs as c (c._id)}
							<div class="flex items-center gap-2">
								<Checkbox
									id={`cls-${c._id}`}
									checked={pickedProgramIds.includes(c._id)}
									onCheckedChange={() => toggleProgram(c._id)}
								/>
								<Label for={`cls-${c._id}`} class="font-normal">{c.name}</Label>
							</div>
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
