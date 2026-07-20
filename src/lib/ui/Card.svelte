<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		padded?: boolean;
		interactive?: boolean;
		/**
		 * `accent` fills the card with the accent and flips its text to near-black — the reference
		 * deck's treatment for the one card a screen is steering somebody towards. It is a spotlight,
		 * so at most one card per screen may wear it; a deck of accent cards has no hierarchy left.
		 */
		tone?: 'surface' | 'accent';
		onclick?: (event: MouseEvent) => void;
		class?: string;
		children: Snippet;
	}

	let {
		padded = true,
		interactive = false,
		tone = 'surface',
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

	const TONES: Record<NonNullable<Props['tone']>, string> = {
		surface: 'bg-surface text-ink',
		accent: 'bg-accent-600 text-on-accent'
	};

	let classes = $derived(
		[
			'rounded-card',
			TONES[tone],
			padded ? 'p-5' : '',
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
