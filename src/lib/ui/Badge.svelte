<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		tone?: 'neutral' | 'success' | 'warn' | 'danger';
		/** The reference's status pill leads with a filled dot. Off for badges that label a fact
		 *  rather than a state — a dot there reads as a status that never changes. */
		dot?: boolean;
		children: Snippet;
	}

	let { tone = 'neutral', dot = false, children }: Props = $props();

	/**
	 * Every tone is one hue at two strengths: the hue for the text, the same hue at 15% for the fill.
	 * That is the reference's badge recipe, and it keeps a status pill legible on both the card and
	 * the page without a second hand-picked colour per tone.
	 */
	const TONES: Record<NonNullable<Props['tone']>, string> = {
		neutral: 'bg-white/[0.06] text-muted',
		success: 'bg-accent/15 text-accent',
		warn: 'bg-warn/15 text-warn',
		danger: 'bg-danger/15 text-danger'
	};

	let toneClass = $derived(TONES[tone]);
</script>

<!-- Fully rounded and tight: the reference reads these as pills on a card, not as boxed labels. -->
<span
	class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-3xs leading-none font-semibold {toneClass}"
>
	{#if dot}
		<!-- currentColor: the dot is the tone's hue by construction, so a tone can never grow a dot
		     that disagrees with its own text. -->
		<span class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true"></span>
	{/if}
	{@render children()}
</span>
