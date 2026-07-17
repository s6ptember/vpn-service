<script lang="ts">
	import type { ClassValue, HTMLTextareaAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLTextareaAttributes, 'value' | 'rows' | 'class'> {
		value: string;
		/** Same rule as Input: `label` renders visibly, otherwise pass `aria-label` through rest props. */
		label?: string;
		/** Human-readable error under the field. Its presence also flips `aria-invalid`. */
		error?: string;
		/**
		 * Soft limit. It drives the counter but is deliberately not set as the native attribute: the
		 * browser would silently truncate a paste, and the person would never learn why. The counter
		 * turns red instead, and the valibot schema on the server stays the real gate.
		 */
		maxlength?: number;
		counter?: boolean;
		rows?: number;
		name?: string;
		placeholder?: string;
		class?: ClassValue;
	}

	let {
		value = $bindable(),
		label,
		error,
		maxlength,
		counter = false,
		rows = 4,
		name,
		placeholder,
		class: className,
		...rest
	}: Props = $props();

	const id = $props.id();
	const errorId = `${id}-error`;
	const counterId = `${id}-counter`;

	let length = $derived(value.length);
	let over = $derived(maxlength !== undefined && length > maxlength);

	// The counter is the only signal that the soft limit exists, so it has to reach the a11y tree:
	// `over` flips aria-invalid, and without this the reason for that state is visual-only.
	let describedBy = $derived(
		[error && errorId, counter && counterId].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="w-full">
	{#if label}
		<label for={id} class="mb-1.5 block px-1 text-[13px] font-medium text-muted">{label}</label>
	{/if}

	<textarea
		{id}
		{name}
		{rows}
		{placeholder}
		bind:value
		aria-invalid={error || over ? 'true' : undefined}
		aria-describedby={describedBy}
		class={[
			'w-full resize-none rounded-card bg-surface p-4 text-[15px] leading-relaxed text-ink select-text placeholder:text-muted',
			className
		]}
		{...rest}></textarea>

	{#if error || counter}
		<div class="mt-2 flex items-start justify-between gap-3 px-1">
			{#if error}
				<p id={errorId} class="text-[13px] text-danger-700">{error}</p>
			{:else}
				<span></span>
			{/if}

			{#if counter}
				<p
					id={counterId}
					class={['shrink-0 text-[13px] tabular-nums', over ? 'text-danger-700' : 'text-muted']}
				>
					{#if maxlength === undefined}{length}{:else}{length} / {maxlength}{/if}
				</p>
			{/if}
		</div>
	{/if}
</div>
