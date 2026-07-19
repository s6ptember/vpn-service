<script lang="ts">
	import { Check } from 'lucide-svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Money from '$lib/ui/Money.svelte';
	import type { PlanDTO, SubscriptionDTO } from '$lib/types';
	import { formatDateShort } from './dates';
	import { formatDays, formatTraffic, perDayMinor } from './plan-value';

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
	 * tech.md 11 puts the срок on the card, and `name` is free text: a plan called «Стартовый» would
	 * otherwise show no duration at all. It leads the list because it is the offer, not a perk.
	 *
	 * The rest are product copy, identical on every card in the mock — only the traffic line varies,
	 * and it is derivable. The mock's "До 3 устройств" is dropped on purpose: tech.md 17.4 states
	 * Marzban gives us no device limit, so it would be a false promise.
	 */
	let features = $derived([
		`Доступ на ${formatDays(plan.durationDays)}`,
		formatTraffic(plan.trafficLimitBytes),
		'Все локации',
		'Ключ работает на всех устройствах'
	]);
</script>

<article class={['rounded-card bg-surface p-4', best && 'ring-1 ring-accent-600']}>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-2">
				<h3 class="text-[17px] leading-none font-semibold">{plan.name}</h3>
				{#if plan.description}
					<!-- The mock's badge slot, fed by the one column that carries seller copy. -->
					<Badge tone={best ? 'success' : 'neutral'}>{plan.description}</Badge>
				{/if}
			</div>
			<p class="mt-1.5 text-[13px] text-muted">
				<Money minor={perDay} currency={plan.currency} /> в день
			</p>
		</div>
		<div class="shrink-0 text-right">
			<p class="text-[22px] leading-none font-bold tabular-nums">
				<Money minor={plan.priceMinor} currency={plan.currency} />
			</p>
		</div>
	</div>

	<ul class="mt-4 space-y-2 border-t border-line pt-4">
		{#each features as feature (feature)}
			<li class="flex items-center gap-2 text-[14px]">
				<Check class="size-4 shrink-0 text-accent-500" aria-hidden="true" />
				{feature}
			</li>
		{/each}
	</ul>

	{#if extendsUntil}
		<p class="mt-3.5 text-[13px] text-muted">
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
	<form method="POST" action="?/createCheckout" use:enhance={onsubmit} class="mt-3.5">
		<input type="hidden" name="planId" value={plan.id} />
		<input type="hidden" name="promoCode" value={promoCode} />
		<Button
			type="submit"
			class="w-full"
			loading={busy}
			disabled={locked && !busy}
			aria-label={`Купить тариф ${plan.name}`}
		>
			{subscription?.status === 'active' ? 'Продлить' : 'Купить'}
		</Button>
	</form>
</article>
