<script lang="ts">
	interface Props {
		photoUrl: string | null;
		firstName: string;
	}

	let { photoUrl, firstName }: Props = $props();

	/**
	 * Telegram's avatar URLs expire, and a dead one renders as a broken-image glyph. Falling back to
	 * the initial keeps the shape intact — this is the one piece of local state the header needs.
	 */
	let broken = $state(false);

	// Split by code point: `'😀'[0]` is half a surrogate pair and renders as a replacement box.
	let initial = $derived([...firstName.trim()][0]?.toUpperCase() ?? '?');
	let showPhoto = $derived(Boolean(photoUrl) && !broken);
</script>

<div
	class="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-accent-400 text-[18px] font-semibold text-white"
>
	{#if showPhoto}
		<!-- Decorative: the name sits right next to it, so a screen reader announcing it twice is noise. -->
		<img
			src={photoUrl}
			alt=""
			class="size-full object-cover"
			referrerpolicy="no-referrer"
			onerror={() => (broken = true)}
		/>
	{:else}
		<span aria-hidden="true">{initial}</span>
	{/if}
</div>
