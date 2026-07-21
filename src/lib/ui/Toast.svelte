<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import { toasts, type ToastTone } from './toasts.svelte';

	/** The mock only ever shows the glass pill. Success and danger swap the fill instead of layering
	 *  a colour over `toast-surface`, which sets `background` and would fight a `bg-*` utility.
	 *  Both filled tones are light colours, so they carry the label rather than inheriting white. */
	const TONE_SURFACE: Record<ToastTone, string> = {
		neutral: 'toast-surface text-ink',
		success: 'bg-accent text-on-accent',
		danger: 'bg-danger text-on-accent'
	};

	let duration = $derived(prefersReducedMotion.current ? 0 : 300);
</script>

<!-- The live region is the wrapper, not the toast: it must already be in the DOM when a message
     lands, otherwise a screen reader never announces the insertion.
     Absolute for the same reason as the island: `fixed` measures 92px off the viewport, which on
     desktop drops the toast below the phone frame instead of above the island. -->
<div
	class="pointer-events-none absolute bottom-[92px] left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
	role="status"
	aria-live="polite"
>
	{#each toasts.items as toast (toast.id)}
		<div
			class={['rounded-full px-4 py-2.5 text-2xs font-semibold', TONE_SURFACE[toast.tone]]}
			in:fly={{ y: prefersReducedMotion.current ? 0 : 8, duration }}
			out:fade={{ duration }}
		>
			{toast.message}
		</div>
	{/each}
</div>
