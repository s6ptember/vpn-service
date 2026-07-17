<script lang="ts">
	import type { Snippet } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fade, fly } from 'svelte/transition';
	import { lockBodyScroll, onEscape, trapFocus } from './dialog';

	interface Props {
		open: boolean;
		title?: string;
		children: Snippet;
	}

	let { open = $bindable(), title, children }: Props = $props();

	const titleId = $props.id();
	let panel = $state<HTMLDivElement | null>(null);

	// Reduced motion kills the slide, not the sheet: it still appears, it just does not travel.
	let motion = $derived(
		prefersReducedMotion.current ? { y: 0, duration: 0 } : { y: 320, duration: 260 }
	);

	function close() {
		open = false;
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
	<div class="fixed inset-0 z-50 flex items-end justify-center">
		<!--
			aria-hidden backdrop: decoration with a shortcut attached, and hidden from the a11y tree so it
			never announces itself. Escape already closes the sheet from the keyboard, so the click is a
			pointer convenience, not the only way out.
		-->
		<div
			class="absolute inset-0 bg-ink/40"
			onclick={close}
			transition:fade={{ duration: motion.duration }}
			aria-hidden="true"
		></div>

		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? titleId : undefined}
			tabindex="-1"
			transition:fly={motion}
			class="sheet island relative max-h-[85dvh] w-full max-w-[430px] overflow-y-auto px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))]"
		>
			{#if title}
				<h2 id={titleId} class="px-1 text-[17px] leading-tight font-semibold">{title}</h2>
			{/if}

			<div class={title && 'mt-4'}>
				{@render children()}
			</div>
		</div>
	</div>
{/if}

<style>
	/* `island` carries the glass tokens; its pill radius is the only part a sheet cannot use. */
	.sheet {
		border-radius: 24px 24px 0 0;
	}
</style>
