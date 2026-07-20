<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Money from '$lib/ui/Money.svelte';
	import type { PlanDTO, SubscriptionDTO } from '$lib/types';
	import { formatDateShort } from './dates';
	import { formatDays, formatTrafficShort, perDayMinor } from './plan-value';

	interface Props {
		plan: PlanDTO;
		/** Lowest daily rate in the deck. Derived by the page, never stored (see plan-value.ts). */
		best?: boolean;
		/** Live access, if any. Turns the price into an extension rather than a start. */
		subscription?: SubscriptionDTO | null;
		/** Opens the payment page. The page owns it, because the answer changes the page. */
		onsubmit: SubmitFunction;
		/** This card's checkout is in flight. Only one can be. */
		busy?: boolean;
		/** Another card's checkout is in flight, or the app is waiting on a payment. */
		locked?: boolean;
		/** The code typed above the deck, submitted with whichever card is bought (tech.md 10, step 1). */
		promoCode?: string;
	}

	let {
		plan,
		best = false,
		subscription = null,
		onsubmit,
		busy = false,
		locked = false,
		promoCode = ''
	}: Props = $props();

	let perDay = $derived(perDayMinor(plan));

	/**
	 * tech.md 11: while a subscription is active, a card says what buying it would extend access to.
	 * The arithmetic mirrors the server's (subscriptions/expiry.ts) — days are added to the end of
	 * live access, never to today — so the promise on the card is the date the job will write.
	 */
	let extendsUntil = $derived(
		subscription && subscription.status === 'active'
			? subscription.expiresAt + plan.durationDays * 86_400_000
			: null
	);

	/**
	 * The best-value card is the deck's one accent fill, exactly as the reference lights one card in
	 * a row. `best` is derived from the prices themselves (plan-value.ts), so the spotlight always
	 * lands on the cheapest daily rate rather than on a flag somebody set by hand.
	 */
	let dimClass = $derived(best ? 'text-on-accent/70' : 'text-muted');

	/**
	 * tech.md 11 puts the срок on the card, and `name` is free text: a plan called «Стартовый» would
	 * otherwise show no duration at all. The three read as the reference's stat pills — a value each,
	 * not a checklist of sentences.
	 *
	 * The mock's "До 3 устройств" is dropped on purpose: tech.md 17.4 states Marzban gives us no
	 * device limit, so it would be a false promise.
	 */
	let facts = $derived([
		formatDays(plan.durationDays),
		formatTrafficShort(plan.trafficLimitBytes),
		'Все локации'
	]);
</script>

<article class={['rounded-card p-5', best ? 'bg-accent-600 text-on-accent' : 'bg-surface']}>
	<div class="flex items-start justify-between gap-3">
		<h3 class="min-w-0 text-h2 leading-tight font-bold tracking-[-.02em]">{plan.name}</h3>
		{#if plan.description}
			<!-- The mock's badge slot, fed by the one column that carries seller copy. -->
			<Badge tone={best ? 'contrast' : 'neutral'}>{plan.description}</Badge>
		{/if}
	</div>

	<!-- The price is the loudest thing on the card, the way every reference card leads with it. -->
	<p class="mt-4 text-display font-bold tracking-[-.03em] tabular-nums">
		<Money minor={plan.priceMinor} currency={plan.currency} />
	</p>
	<p class={['mt-1 text-xs', dimClass]}>
		<Money minor={perDay} currency={plan.currency} /> в день
	</p>

	<ul class="mt-4 flex list-none flex-wrap gap-1.5">
		{#each facts as fact (fact)}
			<li><Badge tone={best ? 'contrast' : 'neutral'}>{fact}</Badge></li>
		{/each}
	</ul>

	{#if extendsUntil}
		<p class={['mt-4 text-xs', dimClass]}>
			Продлит доступ до {formatDateShort(extendsUntil, Date.now())}
		</p>
	{/if}

	<!--
		A form action, not a fetch wrapper (CLAUDE.md 1.5): CSRF by Origin and a working no-JS submit
		come for free. Two fields, and neither is money: the plan id, and the name of a promo code.
		What either is worth is read from the database — there is nowhere here to name a price.

		The code is mirrored into every card rather than shared by one field, because each card is its
		own form: `promoCode` is bound to the deck's single input, so whichever card is tapped carries
		whatever is currently typed.
	-->
	<form method="POST" action="?/createCheckout" use:enhance={onsubmit} class="mt-5">
		<input type="hidden" name="planId" value={plan.id} />
		<input type="hidden" name="promoCode" value={promoCode} />
		<Button
			type="submit"
			variant={best ? 'contrast' : 'primary'}
			class="w-full"
			loading={busy}
			disabled={locked && !busy}
			aria-label={`Купить тариф ${plan.name}`}
		>
			{subscription?.status === 'active' ? 'Продлить' : 'Купить'}
		</Button>
	</form>
</article>
