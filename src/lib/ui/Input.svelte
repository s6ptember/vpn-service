<script lang="ts">
	import type { ClassValue, HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'value' | 'type' | 'class'> {
		value: string;
		/**
		 * Accessible name, rendered visibly above the field.
		 *
		 * One rule, no third state: pass `label` and the field gets a real `<label>`; omit it and the
		 * caller must pass `aria-label` through the rest props instead (the promo field in the mock has
		 * no visible label, only a placeholder). The field always carries exactly one accessible name.
		 */
		label?: string;
		/** Human-readable error under the field. Its presence also flips `aria-invalid`. */
		error?: string;
		type?: 'text' | 'email' | 'password' | 'search' | 'tel' | 'url';
		maxlength?: number;
		placeholder?: string;
		name?: string;
		required?: boolean;
		/**
		 * Promo-code look: the field renders uppercase and the placeholder stays plain.
		 *
		 * Presentational only — `text-transform` does not touch the bound `value`, and
		 * `autocapitalize` is a soft hint no desktop keyboard honours. The caller reads back exactly
		 * what was typed and must normalise it itself; `promo_codes.code` is stored UPPERCASE.
		 */
		uppercase?: boolean;
		class?: ClassValue;
	}

	let {
		value = $bindable(),
		label,
		error,
		type = 'text',
		maxlength,
		placeholder,
		name,
		required = false,
		uppercase = false,
		class: className,
		...rest
	}: Props = $props();

	const id = $props.id();
	const errorId = `${id}-error`;
</script>

<div class="w-full">
	{#if label}
		<label for={id} class="mb-2 block px-1 text-2xs font-medium text-muted">{label}</label>
	{/if}

	<!-- Svelte rejects bind:value on a dynamic `type`, so the binding is written out by hand. -->
	<input
		{id}
		{type}
		{name}
		{maxlength}
		{placeholder}
		{required}
		{value}
		oninput={(event) => (value = event.currentTarget.value)}
		autocapitalize={uppercase ? 'characters' : undefined}
		autocomplete={uppercase ? 'off' : undefined}
		spellcheck={uppercase ? false : undefined}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error ? errorId : undefined}
		class={[
			'h-13 w-full min-w-0 rounded-field border border-line bg-inset px-4 text-sm text-ink select-text placeholder:text-subtle',
			uppercase &&
				'font-medium tracking-[.06em] uppercase placeholder:font-normal placeholder:tracking-normal placeholder:normal-case',
			className
		]}
		{...rest}
	/>

	{#if error}
		<p id={errorId} class="mt-2 px-1 text-2xs text-danger">{error}</p>
	{/if}
</div>
