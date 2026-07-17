<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		tone?: 'neutral' | 'success' | 'warn' | 'danger';
		children: Snippet;
	}

	let { tone = 'neutral', children }: Props = $props();

	const TONES: Record<NonNullable<Props['tone']>, string> = {
		neutral: 'bg-ink/[.07] text-muted',
		success: 'bg-accent-100 text-accent-700',
		warn: 'bg-warn-100 text-warn-700',
		danger: 'bg-danger-100 text-danger-700'
	};

	let toneClass = $derived(TONES[tone]);
</script>

<span
	class="inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[11px] leading-none font-semibold {toneClass}"
>
	{@render children()}
</span>
