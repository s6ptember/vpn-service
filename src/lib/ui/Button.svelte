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

	const VARIANTS: Record<NonNullable<Props['variant']>, string> = {
		primary: 'bg-accent-600 font-semibold text-white',
		ghost: 'bg-ink/[.07] font-medium text-ink',
		danger: 'bg-danger-600 font-semibold text-white'
	};

	const SIZES: Record<NonNullable<Props['size']>, string> = {
		sm: 'h-11 rounded-control',
		md: 'h-12 rounded-field'
	};

	// Loading dims nothing: it reads as busy, not as unavailable, and the spinner must stay crisp.
	let classes = $derived(
		[
			'press relative inline-flex select-none items-center justify-center px-4 text-[15px]',
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
