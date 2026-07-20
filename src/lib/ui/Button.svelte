<script lang="ts">
	import type { Snippet } from 'svelte';
	import { LoaderCircle } from 'lucide-svelte';

	interface Props {
		/**
		 * `contrast` is the variant for a Card with `tone="accent"`: a primary button there would be
		 * accent on accent and disappear. Every other variant assumes a dark surface underneath.
		 */
		variant?: 'primary' | 'ghost' | 'danger' | 'contrast';
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
	 * lavender, the way the reference deck fills its cards. White here would be unreadable.
	 */
	const VARIANTS: Record<NonNullable<Props['variant']>, string> = {
		primary: 'bg-accent-600 font-semibold text-on-accent',
		ghost: 'bg-elevated font-medium text-ink',
		danger: 'bg-danger-600 font-semibold text-on-accent',
		contrast: 'bg-page font-semibold text-ink'
	};

	const SIZES: Record<NonNullable<Props['size']>, string> = {
		sm: 'h-11 text-sm',
		md: 'h-13 text-body'
	};

	// Loading dims nothing: it reads as busy, not as unavailable, and the spinner must stay crisp.
	let classes = $derived(
		[
			'press relative inline-flex select-none items-center justify-center rounded-full px-5',
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
	<span class:invisible={loading}>{@render children()}</span>

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
