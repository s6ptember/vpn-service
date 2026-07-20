<script lang="ts">
	import { User } from 'lucide-svelte';

	interface Props {
		photoUrl: string | null;
		/** Null when nobody is signed in: there is no name to take an initial from. */
		firstName: string | null;
	}

	let { photoUrl, firstName }: Props = $props();

	/**
	 * Telegram's avatar URLs expire, and a dead one renders as a broken-image glyph. Falling back to
	 * the initial keeps the shape intact — this is the one piece of local state the header needs.
	 */
	let broken = $state(false);

	// Split by code point: `'😀'[0]` is half a surrogate pair and renders as a replacement box.
	let initial = $derived(firstName ? ([...firstName.trim()][0]?.toUpperCase() ?? null) : null);
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
	{:else if initial}
		<span aria-hidden="true">{initial}</span>
	{:else}
		<!-- Nobody signed in: no name, no photo, just the empty-avatar glyph. -->
		<User class="size-6" aria-hidden="true" />
	{/if}
</div>
