<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LoaderCircle } from 'lucide-svelte';

	interface Props {
		variant?: 'primary' | 'ghost' | 'danger';
		size?: 'sm' | 'md';
		loading?: boolean;
		disabled?: boolean;
		type?: 'button' | 'submit';
		onclick?: (event: MouseEvent) => void;
		class?: string;
		/** The quality floor (tech.md 12) wants a name on every interactive element: label a button
		 *  whose text alone is ambiguous out of context ("Купить" → "Купить тариф 30 дней"). */
		'aria-label'?: string;
		children: Snippet;
	}

	let {
		variant = 'primary',
		size = 'md',
		loading = false,
		disabled = false,
		type = 'button',
		onclick,
		class: className = '',
		'aria-label': ariaLabel,
		children
	}: Props = $props();

	/**
	 * The accent is a light colour on a dark page, so a primary button inverts: near-black label on
	 * the accent. White here would be unreadable.
	 *
	 * `ghost` is the reference's secondary — a barely-there fill over a hairline, which is what keeps
	 * a pair of them under a primary from reading as three equal choices.
	 */
	const VARIANTS: Record<NonNullable<Props['variant']>, string> = {
		primary: 'bg-accent font-bold text-on-accent',
		ghost: 'border border-line bg-white/[0.06] font-medium text-ink',
		danger: 'bg-danger font-bold text-on-accent'
	};

	/**
	 * Size is the reference's two button shapes rather than a free scale: the primary is taller, on
	 * the wider radius, and a step up in type; the secondary is the compact one that sits in a pair
	 * beneath it. Height comes from padding, so a label that wraps grows the button instead of
	 * spilling out of it.
	 */
	const SIZES: Record<NonNullable<Props['size']>, string> = {
		sm: 'gap-1.5 rounded-control px-4 py-3 text-xs',
		md: 'gap-2 rounded-field px-5 py-3.5 text-sm'
	};

	// Loading dims nothing: it reads as busy, not as unavailable, and the spinner must stay crisp.
	let classes = $derived(
		[
			'press relative inline-flex select-none items-center justify-center leading-tight',
			VARIANTS[variant],
			SIZES[size],
			disabled ? 'opacity-40' : '',
			className
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

<button
	{type}
	{onclick}
	class={classes}
	disabled={disabled || loading}
	aria-busy={loading}
	aria-label={ariaLabel}
>
	<!-- Label keeps its box while loading, so the button never resizes under the spinner. -->
	<span class="contents" class:invisible={loading}>{@render children()}</span>

	{#if loading}
		<span class="pointer-events-none absolute inset-0 grid place-items-center">
			<!-- Spin sits on a span we own: a class handed to a component is not scoped, and the
			     reduced-motion rule below has to reach the spinning element. -->
			<span class="spinner block animate-spin">
				<LoaderCircle size={18} />
			</span>
		</span>
	{/if}
</button>

<style>
	/* The spinner is the only progress signal a loading button has, so reduced motion slows it
	   instead of stopping it. */
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 1.6s;
		}
	}
</style>
