<script lang="ts">
	import { User } from 'lucide-svelte';

	interface Props {
		photoUrl: string | null;
		/** Null when nobody is signed in: there is no name to take an initial from. */
		firstName: string | null;
		/** `lg` is the profile portrait — big, ringed in the accent, the way the reference opens that
		 *  screen. `sm` is the one that rides next to a greeting. */
		size?: 'sm' | 'lg';
	}

	let { photoUrl, firstName, size = 'sm' }: Props = $props();

	/**
	 * Telegram's avatar URLs expire, and a dead one renders as a broken-image glyph. Falling back to
	 * the initial keeps the shape intact — this is the one piece of local state the header needs.
	 */
	let broken = $state(false);

	// Split by code point: `'😀'[0]` is half a surrogate pair and renders as a replacement box.
	let initial = $derived(firstName ? ([...firstName.trim()][0]?.toUpperCase() ?? null) : null);
	let showPhoto = $derived(Boolean(photoUrl) && !broken);

	/**
	 * The ring is drawn with a box-shadow rather than `ring` + `ring-offset`: Tailwind's offset is
	 * painted in a flat colour, and this avatar sits on the page and on a card at different times.
	 * Two shadows — a page-coloured gap, then the accent — keep the gap transparent to whatever is
	 * actually behind it.
	 */
	const SIZES: Record<NonNullable<Props['size']>, string> = {
		sm: 'size-12 text-h3',
		lg: 'size-24 text-display shadow-[0_0_0_4px_var(--color-page),0_0_0_6px_var(--color-accent-600)]'
	};
</script>

<div
	class={[
		'grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent-600 font-bold text-on-accent',
		SIZES[size]
	]}
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
		<User class={size === 'lg' ? 'size-10' : 'size-6'} aria-hidden="true" />
	{/if}
</div>
