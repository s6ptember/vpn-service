<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { haptic } from '$lib/client/telegram-haptics';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Money from '$lib/ui/Money.svelte';
	import SectionHeading from '$lib/ui/SectionHeading.svelte';
	import type { Currency, PromoCodeDTO } from '$lib/types';

	interface Props {
		/** The answer to the last check, if the page has one. */
		result?: {
			ok: boolean;
			message: string | null;
			promo: PromoCodeDTO | null;
			code: string;
		} | null;
		/** One currency for the whole base (tech.md 5). A fixed discount is money and has to say so. */
		currency: Currency;
	}

	let { result = null, currency }: Props = $props();

	// Seeded from the echo so a no-JS reload comes back filled; after mount the field belongs to the
	// person typing in it, which is why this is read once and never re-synced from the prop.
	let code = $state(untrack(() => result?.code ?? ''));
	let checking = $state(false);

	/**
	 * A message stands only while the field still holds the code the server answered about. Editing
	 * it retires the answer — one that survives the correction tells somebody their fix did not take.
	 *
	 * Both sides are normalised the way the schema normalises them, and that is not cosmetic: a
	 * refusal echoes back exactly what was typed, so comparing a raw `start30` against an upper-cased
	 * `START30` would hide every error message the moment somebody typed in lower case.
	 */
	const normalise = (value: string) => value.trim().toUpperCase();

	let answer = $derived(result && normalise(code) === normalise(result.code) ? result : null);
</script>

<SectionHeading title="Промокод" />

<form
	method="POST"
	action="?/checkPromo"
	class="flex gap-2"
	use:enhance={() => {
		checking = true;

		return async ({ update }) => {
			// reset: false keeps what was typed — the answer below is about exactly that string.
			await update({ reset: false });
			checking = false;
			haptic();
		};
	}}
>
	<Input
		bind:value={code}
		name="promoCode"
		aria-label="Промокод"
		placeholder="Промокод"
		maxlength={32}
		uppercase
		error={answer && !answer.ok ? (answer.message ?? undefined) : undefined}
	/>
	<Button type="submit" variant="ghost" size="md" loading={checking}>Применить</Button>
</form>

{#if answer?.ok && answer.promo}
	<p class="mt-2.5 px-1 text-2xs font-medium text-accent" role="status" aria-live="polite">
		<!--
			What the CODE is worth, not what this purchase will cost: the final price depends on the
			plan, and the Stripe floor can eat part of a discount on the cheapest one (tech.md 10). The
			amount somebody is actually charged is shown once, on the payment page.
		-->
		Промокод {answer.promo.code} работает: скидка
		{#if answer.promo.discountType === 'percent'}
			{answer.promo.discountValue}%
		{:else}
			<Money minor={answer.promo.discountValue} {currency} />
		{/if}. Введите его при покупке на главной.
	</p>
{/if}
