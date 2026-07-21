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
	 * The portrait is a dark disc with an accent rim, not an accent fill: the reference keeps the
	 * accent as an outline here, so a photo inside it is never tinted by the ring around it.
	 *
	 * The halo is a spread shadow in the accent at 8%, which leaves the gap between rim and halo
	 * showing whatever is actually behind the avatar. Tailwind's `ring-offset` paints that gap a flat
	 * colour instead, and this sits on the page and on a card at different times.
	 */
	const SIZES: Record<NonNullable<Props['size']>, string> = {
		sm: 'size-[46px] border-2 text-h4 shadow-[0_0_0_4px_rgb(182_202_235/0.08)]',
		lg: 'size-28 border-[3px] text-display shadow-[0_0_0_6px_rgb(182_202_235/0.08),0_0_44px_-6px_rgb(182_202_235/0.3)]'
	};
</script>

<div
	class={[
		'grid shrink-0 place-items-center overflow-hidden rounded-full border-accent bg-elevated font-bold text-ink',
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
		<User class={size === 'lg' ? 'size-10' : 'size-5'} aria-hidden="true" />
	{/if}
</div>
