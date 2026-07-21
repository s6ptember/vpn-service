<script lang="ts">
	import type { ComponentType, Snippet, SvelteComponent } from 'svelte';
	import type { IconProps } from 'lucide-svelte';

	interface Props {
		/** A lucide icon. Optional: a chip is a label first, and the glyph is what makes it scannable.
		 *  lucide-svelte still ships class components, so this is a ComponentType and not a Component. */
		icon?: ComponentType<SvelteComponent<IconProps>>;
		children: Snippet;
	}

	let { icon: Icon, children }: Props = $props();
</script>

<!--
	An outlined pill on the page itself, not a filled chip on a card: the reference puts this row
	directly under the greeting, and an outline keeps it quiet enough to stay a caption for the screen
	rather than competing with the card below it. The glyph carries the accent, the label stays white
	— the reverse would turn a row of three into three small headings.
-->
<span
	class="inline-flex shrink-0 items-center gap-2 rounded-full border border-line-strong px-3.5 py-2.5 text-2xs font-medium text-ink"
>
	{#if Icon}
		<Icon class="size-[17px] text-accent" strokeWidth={1.8} aria-hidden={true} />
	{/if}
	{@render children()}
</span>
