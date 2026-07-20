<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/**
		 * `contrast` is the one tone meant for an accent-filled Card: it inverts to the page colour so
		 * the pill still separates from what it sits on. Every other tone assumes a dark surface and
		 * would vanish there.
		 */
		tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'contrast';
		children: Snippet;
	}

	let { tone = 'neutral', children }: Props = $props();

	const TONES: Record<NonNullable<Props['tone']>, string> = {
		neutral: 'bg-elevated text-muted',
		success: 'bg-accent-100 text-accent-700',
		warn: 'bg-warn-100 text-warn-700',
		danger: 'bg-danger-100 text-danger-700',
		contrast: 'bg-page text-ink'
	};

	let toneClass = $derived(TONES[tone]);
</script>

<!-- Fully rounded and tight: the reference reads these as pills on a card, not as boxed labels. -->
<span
	class="inline-flex items-center rounded-full px-2.5 py-1 text-xs leading-none font-semibold {toneClass}"
>
	{@render children()}
</span>
