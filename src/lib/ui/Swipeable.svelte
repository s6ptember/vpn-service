<script lang="ts">
	import type { Snippet } from 'svelte';
	import { preloadData } from '$app/navigation';
	import { prefersReducedMotion } from 'svelte/motion';
	import { haptic } from '$lib/client/telegram-haptics';
	import { SECTIONS } from './nav';

	let {
		index,
		count,
		onnavigate,
		children
	}: {
		index: number;
		count: number;
		onnavigate: (nextIndex: number) => void;
		children: Snippet;
	} = $props();

	/** Movement before the gesture picks an axis. Below this a finger is just noise. */
	const AXIS_LOCK_PX = 10;
	const PRELOAD_AFTER_PX = 20;
	/** tech.md 11: distance or throw commits the navigation. */
	const COMMIT_PX = 60;
	const COMMIT_VELOCITY = 0.4; // px/ms
	/** Past the first and last section the content still moves, just grudgingly. */
	const EDGE_RESISTANCE = 0.35;
	/** A finger that parked before lifting has no throw, however fast it moved earlier. */
	const VELOCITY_STALE_MS = 100;

	let host: HTMLDivElement | null = null;

	// Only the offset reaches the DOM. The rest is gesture bookkeeping: making it $state would
	// invalidate the component on every pointermove for nothing.
	let offset = $state(0);
	let dragging = $state(false);

	let pointerId: number | null = null;
	let axis: 'none' | 'x' | 'y' = 'none';
	let startX = 0;
	let startY = 0;
	let lastX = 0;
	let lastTime = 0;
	let velocity = 0;
	let preloaded = false;

	// No transform at rest: a transformed ancestor becomes the containing block for `position: fixed`
	// descendants, which would nail the island (and any sheet) to this wrapper instead of the viewport.
	let transform = $derived(offset === 0 ? undefined : `transform: translate3d(${offset}px, 0, 0);`);

	/** Section the gesture is heading for, or null at either end of the list. */
	function targetIndex(dx: number): number | null {
		const next = dx < 0 ? index + 1 : index - 1;
		return next >= 0 && next < count ? next : null;
	}

	function reset(): void {
		pointerId = null;
		axis = 'none';
		velocity = 0;
		preloaded = false;
		dragging = false;
		offset = 0;
	}

	function onPointerDown(event: PointerEvent): void {
		if (pointerId !== null || !event.isPrimary) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;

		pointerId = event.pointerId;
		axis = 'none';
		startX = event.clientX;
		startY = event.clientY;
		lastX = event.clientX;
		lastTime = event.timeStamp;
		velocity = 0;
		preloaded = false;
	}

	function onPointerMove(event: PointerEvent): void {
		if (event.pointerId !== pointerId) return;

		const dx = event.clientX - startX;
		const dy = event.clientY - startY;

		if (axis === 'none') {
			if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return;
			// Decided once, then honoured for the whole gesture. Ties go to the page: vertical
			// scrolling must survive a sloppy finger.
			axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
			if (axis === 'y') {
				reset();
				return;
			}
			dragging = true;
			host?.setPointerCapture(event.pointerId);
		}

		const dt = event.timeStamp - lastTime;
		if (dt > 0) velocity = (event.clientX - lastX) / dt;
		lastX = event.clientX;
		lastTime = event.timeStamp;

		const next = targetIndex(dx);

		// tech.md 11: the data has to be there by the time the gesture lands, or the next section
		// flashes a skeleton. Once per gesture — preloadData dedupes, the flag says so out loud.
		// `count` is a prop while SECTIONS is fixed at three, so a caller that swipes over anything
		// else (kitchen sink) must not crash here: no section, no preload, gesture still commits.
		if (!preloaded && next !== null && Math.abs(dx) >= PRELOAD_AFTER_PX) {
			const href = SECTIONS.at(next)?.href;
			if (href) {
				preloaded = true;
				void preloadData(href);
			}
		}

		// Reduced motion keeps the content still. The commit below still fires.
		if (!prefersReducedMotion.current) {
			offset = next === null ? dx * EDGE_RESISTANCE : dx;
		}
	}

	function onPointerUp(event: PointerEvent): void {
		if (event.pointerId !== pointerId) return;

		const dx = event.clientX - startX;
		const next = targetIndex(dx);

		if (axis !== 'x' || next === null) {
			reset();
			return;
		}

		const stale = event.timeStamp - lastTime > VELOCITY_STALE_MS;
		const flick =
			!stale && Math.abs(velocity) > COMMIT_VELOCITY && Math.sign(velocity) === Math.sign(dx);
		const commit = Math.abs(dx) >= COMMIT_PX || flick;

		reset();

		if (commit) {
			haptic();
			onnavigate(next);
		}
	}

	function onPointerCancel(event: PointerEvent): void {
		if (event.pointerId !== pointerId) return;
		reset();
	}

	// Pointer listeners are outside Svelte, so an effect with teardown is the right seam.
	$effect(() => {
		const el = host;
		if (!el) return;

		el.addEventListener('pointerdown', onPointerDown);
		el.addEventListener('pointermove', onPointerMove);
		el.addEventListener('pointerup', onPointerUp);
		el.addEventListener('pointercancel', onPointerCancel);

		return () => {
			el.removeEventListener('pointerdown', onPointerDown);
			el.removeEventListener('pointermove', onPointerMove);
			el.removeEventListener('pointerup', onPointerUp);
			el.removeEventListener('pointercancel', onPointerCancel);
		};
	});
</script>

<!-- touch-pan-y hands vertical scrolling to the browser and keeps the horizontal axis for us;
     when the browser claims the gesture it sends pointercancel and reset() lets go. -->
<div bind:this={host} class="h-full w-full touch-pan-y">
	<div
		class={[
			'h-full w-full',
			!dragging &&
				!prefersReducedMotion.current &&
				'transition-transform duration-[420ms] ease-[var(--ease-spring)]'
		]}
		style={transform}
	>
		{@render children()}
	</div>
</div>
