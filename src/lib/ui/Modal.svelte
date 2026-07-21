<script lang="ts">
	import type { Snippet } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fade, scale } from 'svelte/transition';
	import Button from './Button.svelte';
	import { lockBodyScroll, onEscape, trapFocus } from './dialog';

	interface Props {
		open: boolean;
		title?: string;
		children: Snippet;
		/** Omit it and the dialog shows only the dismiss button. */
		onconfirm?: () => void;
		confirmLabel?: string;
		cancelLabel?: string;
	}

	let {
		open = $bindable(),
		title,
		children,
		onconfirm,
		confirmLabel = 'Подтвердить',
		cancelLabel = 'Отмена'
	}: Props = $props();

	const titleId = $props.id();
	let panel = $state<HTMLDivElement | null>(null);

	let motion = $derived(prefersReducedMotion.current ? { duration: 0 } : { duration: 180 });

	function close() {
		open = false;
	}

	function confirm() {
		onconfirm?.();
		close();
	}

	// Escape, focus and page scroll all live outside Svelte, so an effect is the right tool here.
	$effect(() => {
		if (!open || !panel) return;

		const release = [lockBodyScroll(), trapFocus(panel), onEscape(close)];
		return () => {
			for (const fn of release) fn();
		};
	});
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<!--
			aria-hidden backdrop: decoration with a shortcut attached, and hidden from the a11y tree so it
			never announces itself. Escape already closes the dialog from the keyboard, so the click is a
			pointer convenience, not the only way out.
		-->
		<div
			class="absolute inset-0 bg-black/65"
			onclick={close}
			transition:fade={motion}
			aria-hidden="true"
		></div>

		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? titleId : undefined}
			tabindex="-1"
			transition:scale={{ start: 0.96, duration: motion.duration }}
			class="relative max-h-[85dvh] w-full max-w-[340px] overflow-y-auto card p-5"
		>
			{#if title}
				<h2 id={titleId} class="text-h2 leading-tight font-bold tracking-[-.02em]">{title}</h2>
			{/if}

			<div class={title && 'mt-2'}>
				{@render children()}
			</div>

			<div class={['mt-4 grid gap-2', onconfirm && 'grid-cols-2']}>
				<Button variant="ghost" size="md" onclick={close}>{cancelLabel}</Button>
				{#if onconfirm}
					<Button variant="primary" size="md" onclick={confirm}>{confirmLabel}</Button>
				{/if}
			</div>
		</div>
	</div>
{/if}
