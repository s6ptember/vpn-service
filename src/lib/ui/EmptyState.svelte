<script lang="ts">
	import type { Snippet } from 'svelte';
	import Card from './Card.svelte';

	interface Props {
		title: string;
		description?: string;
		action?: Snippet;
	}

	let { title, description, action }: Props = $props();
</script>

<Card>
	<p class="text-[16px] font-semibold">{title}</p>
	{#if description}
		<p class="mt-1 text-[14px] text-muted">{description}</p>
	{/if}
	{#if action}
		<div class="mt-3.5">
			{@render action()}
		</div>
	{/if}
</Card>
