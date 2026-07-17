<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		padded?: boolean;
		interactive?: boolean;
		onclick?: (event: MouseEvent) => void;
		class?: string;
		children: Snippet;
	}

	let {
		padded = true,
		interactive = false,
		onclick,
		class: className = '',
		children
	}: Props = $props();

	/**
	 * A card is interactive or it is not: the affordance and the element that carries it must never
	 * disagree. `interactive` alone used to render a div with a pointer cursor and press feedback —
	 * something that looks clickable but is unreachable from a keyboard. `onclick` alone used to
	 * render a button with no press feedback, the only affordance a WebView has (there is no hover).
	 */
	let clickable = $derived(interactive || Boolean(onclick));

	let classes = $derived(
		[
			'rounded-card bg-surface',
			padded ? 'p-4' : '',
			clickable ? 'press cursor-pointer' : '',
			className
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

{#if clickable}
	<!-- A clickable card is a real button: div + onclick is unreachable from a keyboard. -->
	<button type="button" {onclick} class="block w-full text-left {classes}">
		{@render children()}
	</button>
{:else}
	<div class={classes}>
		{@render children()}
	</div>
{/if}
