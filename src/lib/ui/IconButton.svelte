<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Renders an anchor instead of a button. Navigation is a link, and a link must be one: it
		 *  opens in a new tab, it preloads, it survives a dead JS bundle. */
		href?: string;
		onclick?: (event: MouseEvent) => void;
		/** Never optional: this control is an icon and has no text for a screen reader to read. */
		'aria-label': string;
		class?: string;
		children: Snippet;
	}

	let { href, onclick, 'aria-label': ariaLabel, class: className = '', children }: Props = $props();

	/**
	 * The reference hangs these off the corners of a screen — settings, notifications, the admin
	 * entrance. A disc of card colour over a hairline, with the glyph in the accent: the same recipe
	 * as a card, shrunk to 40px, so it reads as part of the same surface family rather than as a
	 * floating button.
	 */
	const CLASSES =
		'press grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-accent';
</script>

{#if href}
	<a {href} data-sveltekit-preload-data="tap" class="{CLASSES} {className}" aria-label={ariaLabel}>
		{@render children()}
	</a>
{:else}
	<button type="button" {onclick} class="{CLASSES} {className}" aria-label={ariaLabel}>
		{@render children()}
	</button>
{/if}
