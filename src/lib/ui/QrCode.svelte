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

<!--
	role="img" makes the generated SVG presentational, so the label below is the whole a11y story.

	The plate stays white on a dark page rather than inverting with the theme: an inverted QR (light
	modules on dark) is out of spec, and enough scanners refuse to read one that the safe thing is to
	carry the light plate into the dark design as a deliberate object.
-->
<div
	class="qr mx-auto aspect-square rounded-field bg-white p-3"
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

	/* qrcode paints the modules with literal hex; repaint them to the contrast the spec expects,
	   which on the white plate above is plain black — not the theme's ink. */
	.qr :global(svg path[fill]) {
		fill: #ffffff;
	}

	.qr :global(svg path[stroke]) {
		stroke: #000000;
	}
</style>
