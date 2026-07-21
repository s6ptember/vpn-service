<script lang="ts">
	import { resolve } from '$app/paths';
	import { prefersReducedMotion } from 'svelte/motion';
	import { haptic } from '$lib/client/telegram-haptics';
	import type { Section } from './nav';

	let { sections, activeIndex }: { sections: readonly Section[]; activeIndex: number } = $props();

	/** A tab is 52px wide and the rail sets them 6px apart, so the pill travels 58px per section. */
	const ITEM_STRIDE = 58;

	let pillTransform = $derived(`transform: translate3d(${activeIndex * ITEM_STRIDE}px, 0, 0);`);
</script>

<!-- The wrapper stays transparent to the pointer so the page keeps scrolling under the island;
     only the rail itself takes events.
     Absolute, not fixed: the layout frame is the mini app. On a phone the frame is the viewport and
     the two agree, but on desktop the frame is a phone mock-up and `fixed` hangs the island off the
     viewport bottom, far below the rounded edge it belongs to. -->
<nav
	class="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center pb-[max(18px,calc(env(safe-area-inset-bottom)+18px))]"
	aria-label="Разделы"
>
	<div class="pointer-events-auto island flex gap-1.5 rounded-island px-3 py-[9px]">
		<!--
			The travelling pill is a tint, not a fill: the reference marks the active tab by lifting it
			a few percent out of the rail and colouring the icon, so the accent stays a highlight rather
			than becoming a third button-sized block of colour at the bottom of every screen.
		-->
		<span
			class={[
				'pointer-events-none absolute top-[9px] left-3 h-11 w-[52px] rounded-full bg-accent/12 will-change-transform',
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
					'relative z-10 grid h-11 w-[52px] place-items-center rounded-full',
					active ? 'text-accent' : 'text-subtle',
					!prefersReducedMotion.current && 'transition-colors duration-[420ms]'
				]}
				aria-label={section.label}
				aria-current={active ? 'page' : undefined}
				onclick={() => haptic()}
			>
				<Icon class="size-6" strokeWidth={1.8} />
			</a>
		{/each}
	</div>
</nav>
