<script lang="ts">
	import { toString as toSvg } from 'qrcode';

	interface Props {
		value: string;
		size?: number;
	}

	let { value, size = 140 }: Props = $props();

	let markup = $state('');

	// `qrcode.toString` is async and `$derived.by` cannot await, so the SVG cannot be a computed value:
	// this is a real sync with the world outside Svelte and belongs in an $effect keyed on `value`.
	// The cancelled flag drops a stale answer, otherwise a slow first call could land after a newer one
	// and paint the QR of a link that is no longer on screen.
	$effect(() => {
		let cancelled = false;

		toSvg(value, { type: 'svg', margin: 0 })
			.then((svg) => {
				if (!cancelled) markup = svg;
			})
			.catch(() => {
				if (!cancelled) markup = '';
			});

		return () => {
			cancelled = true;
		};
	});
</script>

<!-- role="img" makes the generated SVG presentational, so the label below is the whole a11y story. -->
<div
	class="qr mx-auto aspect-square"
	style:width="{size}px"
	role="img"
	aria-label="QR-код подписки"
>
	<!--
		Trusted markup, not an XSS hole: `qrcode` builds this SVG locally from `value` and emits only
		<svg> and <path>. Nothing user-authored reaches the parser.
	-->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html markup}
</div>

<style>
	.qr :global(svg) {
		display: block;
		height: auto;
		width: 100%;
	}

	/* qrcode paints the modules with literal hex; repaint from the tokens instead of passing hex in. */
	.qr :global(svg path[fill]) {
		fill: var(--color-surface);
	}

	.qr :global(svg path[stroke]) {
		stroke: var(--color-ink);
	}
</style>
