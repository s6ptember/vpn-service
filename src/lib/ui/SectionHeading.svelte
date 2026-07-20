<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		/** Trailing control on the same line — the admin's «Новый», for instance. */
		action?: Snippet;
	}

	let { title, action }: Props = $props();
</script>

<!--
	The reference deck separates its sections with a heavy title and a hairline running to the edge,
	not with a small uppercase label. Every screen used to spell that out inline as a nine-class
	`<h2>`, which is how the old design drifted: eleven copies, three of them subtly different.

	The rule is decoration and is hidden from the a11y tree; the heading keeps its level, so the
	document outline is still a list of sections.
-->
<div class="mt-8 mb-3 flex items-center gap-3">
	<h2 class="shrink-0 text-h2 font-bold tracking-[-.02em]">{title}</h2>
	<span class="h-px min-w-4 flex-1 bg-line" aria-hidden="true"></span>
	{#if action}
		<div class="shrink-0">{@render action()}</div>
	{/if}
</div>
