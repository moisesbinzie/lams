<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getToken } from '$lib/lams/auth';
	import * as Card from '$lib/components/ui/card';
	import OfferingTree from '$lib/components/lams/offering-tree.svelte';
	import StudentNav from '$lib/components/lams/student-nav.svelte';

	let token = getToken();
	let ready = $state(false);

	onMount(() => {
		if (!token) {
			void goto('/signin');
			return;
		}
		ready = true;
	});
</script>

<StudentNav />
<div class="text-center">
	<h1 class="text-2xl font-bold text-lams-navy">My courses</h1>
	<p class="text-sm text-muted-foreground">
		Select a semester and search for the courses you take, then join them directly — or send a
		request for courses in other programmes. Leave courses with nothing recorded. Your program
		rep or lecturer can also add you.
	</p>
</div>

{#if ready}
	<Card.Root>
		<Card.Content class="pt-6">
			<OfferingTree {token} mode="student" />
		</Card.Content>
	</Card.Root>
{/if}
