<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from 'lucide-svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fade, fly } from 'svelte/transition';
	import { lockBodyScroll, onEscape, trapFocus } from './dialog';

	interface Props {
		open: boolean;
		title?: string;
		/** Sits under the title, in the reference's muted step — one line saying what the sheet wants. */
		description?: string;
		children: Snippet;
	}

	let { open = $bindable(), title, description, children }: Props = $props();

	const titleId = $props.id();
	let panel = $state<HTMLDivElement | null>(null);

	// Reduced motion kills the slide, not the sheet: it still appears, it just does not travel.
	let motion = $derived(
		prefersReducedMotion.current ? { y: 0, duration: 0 } : { y: 320, duration: 340 }
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
			never announces itself. Escape already closes the sheet from the keyboard and the corner
			button closes it by pointer, so this click is a convenience, not the only way out.
		-->
		<div
			class="absolute inset-0 bg-black/55"
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
			class="sheet relative no-scrollbar max-h-[90dvh] w-full max-w-[460px] overflow-y-auto px-5 pt-3 pb-[max(22px,calc(env(safe-area-inset-bottom)+22px))]"
		>
			<!-- Grab handle. Decoration: the sheet is not draggable, but the reference draws it and it is
			     what tells somebody the panel is dismissible at all. -->
			<div class="mx-auto mt-0.5 mb-3 h-1 w-10 rounded-full bg-white/20" aria-hidden="true"></div>

			{#if title}
				<div class="mb-1.5 flex items-center justify-between gap-3">
					<h2 id={titleId} class="text-h2 leading-tight font-bold tracking-[-.02em]">{title}</h2>
					<button
						type="button"
						onclick={close}
						class="grid size-[34px] shrink-0 press place-items-center rounded-full bg-white/[0.06] text-ink"
						aria-label="Закрыть"
					>
						<X class="size-[18px]" aria-hidden="true" />
					</button>
				</div>
			{/if}

			{#if description}
				<p class="mb-4 text-2xs text-muted">{description}</p>
			{/if}

			<div class={!description && title ? 'mt-4' : ''}>
				{@render children()}
			</div>
		</div>
	</div>
{/if}

<style>
	/**
	 * A sheet sits between page and card in the stack, so it gets its own fill rather than borrowing
	 * either: on `page` it would vanish into the screen it is covering, and on `surface` the cards
	 * inside it would flatten into one block with gaps.
	 *
	 * Solid, not glass. The floating tab bar is a 60px rail where see-through reads as depth, but a
	 * sheet covers most of the screen: at any transparency the headings behind it print through the
	 * panel and compete with its own content. The top hairline and the upward shadow are what lift it.
	 */
	.sheet {
		border-radius: 26px 26px 0 0;
		background: var(--color-sheet);
		border-top: 1px solid var(--color-line);
		box-shadow: 0 -24px 60px -24px rgb(0 0 0 / 0.75);
	}
</style>
