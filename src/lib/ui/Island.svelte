<script lang="ts">
	import { resolve } from '$app/paths';
	import { prefersReducedMotion } from 'svelte/motion';
	import { haptic } from '$lib/client/telegram-haptics';
	import type { Section } from './nav';

	let { sections, activeIndex }: { sections: readonly Section[]; activeIndex: number } = $props();

	/** One button is h-12 w-16: the pill travels exactly one button width per section. */
	const ITEM_WIDTH = 64;

	let pillTransform = $derived(`transform: translate3d(${activeIndex * ITEM_WIDTH}px, 0, 0);`);
</script>

<!-- The wrapper stays transparent to the pointer so the page keeps scrolling under the island;
     only the rail itself takes events.
     Absolute, not fixed: the layout frame is the mini app. On a phone the frame is the viewport and
     the two agree, but on desktop the frame is an 880px phone mock-up and `fixed` hangs the island
     off the viewport bottom, 120px below the rounded edge it belongs to. -->
<nav
	class="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center pb-[max(14px,env(safe-area-inset-bottom))]"
	aria-label="Разделы"
>
	<div class="island pointer-events-auto flex p-1.5">
		<span
			class={[
				'pointer-events-none absolute top-1.5 left-1.5 h-12 w-16 rounded-full bg-accent-600 island-pill will-change-transform',
				!prefersReducedMotion.current &&
					'transition-transform duration-[420ms] ease-[var(--ease-spring)]'
			]}
			style={pillTransform}
			aria-hidden="true"
		></span>

		{#each sections as section (section.index)}
			{@const Icon = section.icon}
			{@const active = section.index === activeIndex}
			<!-- Anchors, not buttons: navigation works without JS and SvelteKit can preload on tap. -->
			<a
				href={resolve(section.href)}
				data-sveltekit-preload-data="tap"
				class={[
					'relative z-10 grid h-12 w-16 place-items-center rounded-full',
					active ? 'text-white' : 'text-muted',
					!prefersReducedMotion.current && 'transition-colors duration-[420ms]'
				]}
				aria-label={section.label}
				aria-current={active ? 'page' : undefined}
				onclick={() => haptic()}
			>
				<Icon class="size-[22px]" strokeWidth={1.7} />
			</a>
		{/each}
	</div>
</nav>
