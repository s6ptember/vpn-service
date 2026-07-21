<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import { CreditCard } from 'lucide-svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { checkoutWatcher, consumeCheckoutReturn } from '$lib/client/checkout.svelte';
	import { openExternal } from '$lib/client/open-link';
	import { haptic } from '$lib/client/telegram-haptics';
	import { webApp } from '$lib/client/telegram-webapp';
	import { TELEGRAM_SESSION_KEY, type TelegramSession } from '$lib/client/telegram.svelte';
	import Button from '$lib/ui/Button.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import { toasts } from '$lib/ui/toasts.svelte';
	import CheckoutStatus from './CheckoutStatus.svelte';
	import CurrentPlanCard from './CurrentPlanCard.svelte';
	import { formatDateShort } from './dates';
	import FeaturePills from './FeaturePills.svelte';
	import PlanOption from './PlanOption.svelte';
	import { bestValuePlanId } from './plan-value';
	import WelcomeHeader from './WelcomeHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const session = getContext<TelegramSession>(TELEGRAM_SESSION_KEY);

	let bestId = $derived(bestValuePlanId(data.plans));

	/**
	 * What the deck is pointing at. Null until somebody picks: the selection then falls back to the
	 * best value on offer, and to the first plan when nothing wins outright.
	 *
	 * A $derived over the choice rather than an $effect syncing two states (CLAUDE.md 1.1) — the deck
	 * reloads plans on every navigation, and an effect would fight the person's pick each time.
	 */
	let chosenPlanId = $state<number | null>(null);
	let selectedPlanId = $derived(chosenPlanId ?? bestId ?? data.plans[0]?.id ?? null);
	let selectedPlan = $derived(data.plans.find((plan) => plan.id === selectedPlanId) ?? null);

	/** A checkout is in flight. Only one at a time — buying twice is never intended. */
	let submitting = $state(false);

	/** A failed checkout leaves a message on `form`; it must not sit under the next attempt's banner. */
	let errorDismissed = $state(false);

	/** tech.md 10, step 1: optional, and posted with whichever plan is bought. Typed in its own sheet,
	 *  but it is one field shared by both — whatever is typed rides along with the purchase. */
	let promoCode = $state('');

	// Open already if a no-JS submit came back with a refusal on this very load — the banner lives
	// inside the sheet now, and a closed sheet would hide the one thing this reload has to say.
	// untrack: only the value form carries on THIS load matters, same as PromoBlock's seed.
	let buySheetOpen = $state(untrack(() => Boolean(form?.message)));
	let promoSheetOpen = $state(false);

	const watcher = checkoutWatcher;

	/**
	 * The watcher outlives this page, so it is lent a getter rather than a copy: `data` stays the
	 * single source of truth, and mirroring it into $state would need an $effect to keep the two in
	 * step — the exact pattern CLAUDE.md 1.1 forbids.
	 */
	$effect(() =>
		watcher.attach(() => ({
			subscription: data.subscription,
			latestOrder: data.latestOrder,
			awaitingKey: data.awaitingKey
		}))
	);

	let phase = $derived(watcher.phase);
	let active = $derived(data.subscription?.status === 'active');
	// While a payment is in flight, a second Купить would open a second order for the same person.
	let locked = $derived(submitting || phase === 'waiting' || phase === 'granting');

	/**
	 * tech.md 11: while a subscription is active, the deck says what buying would extend access to.
	 * The arithmetic mirrors the server's (subscriptions/expiry.ts) — days are added to the end of
	 * live access, never to today — so the promise here is the date the job will write.
	 */
	let extendsUntil = $derived(
		selectedPlan && data.subscription && active
			? data.subscription.expiresAt + selectedPlan.durationDays * 86_400_000
			: null
	);

	/**
	 * Telegram's start_param is the world outside Svelte, which is what $effect is for. It says only
	 * "a payment attempt just ended": the publicId inside it is deliberately not matched (see
	 * checkout.svelte.ts).
	 *
	 * untrack, and it matters: `start()` reads the watcher's own phase, so without it this effect
	 * would subscribe to `data` and re-run on every poll — restarting the minute over and over, so
	 * the «не дождались» state could never be reached at all.
	 */
	$effect(() => {
		untrack(() => {
			const outcome = consumeCheckoutReturn(webApp()?.initDataUnsafe?.start_param);

			if (outcome === 'returned') watcher.start();
			if (outcome === 'canceled') watcher.markCanceled();
		});
	});

	/** Only one sheet is ever meant to be on screen; opening one puts the other away first. */
	function openBuy() {
		haptic();
		promoSheetOpen = false;
		buySheetOpen = true;
	}

	function openPromo() {
		haptic();
		buySheetOpen = false;
		promoSheetOpen = true;
	}

	/**
	 * Before a purchase there is nothing to install yet, so this opens the same sheet Купить does. A
	 * live subscription sends the person to the real instructions instead (routes/(app)/setup).
	 */
	function openSetup() {
		haptic();
		if (active) {
			goto(resolve('/setup'));
		} else {
			openBuy();
		}
	}

	function selectPlan(planId: number) {
		haptic();
		chosenPlanId = planId;
	}

	const startCheckout: SubmitFunction = () => {
		submitting = true;
		// Whatever the last attempt complained about is about to stop being true.
		errorDismissed = true;

		return async ({ result, update }) => {
			submitting = false;

			if (
				result.type === 'success' &&
				typeof result.data?.url === 'string' &&
				typeof result.data?.orderId === 'number'
			) {
				haptic();
				const orderId = result.data.orderId;

				/**
				 * The payment page opens in a real browser (tech.md 10) and the mini app stays behind
				 * it showing «Ждём оплату». The wait starts only once the link is actually on screen:
				 * a browser that refused to open would leave somebody watching a spinner for a page
				 * they never saw.
				 */
				if (openExternal(result.data.url)) {
					buySheetOpen = false;
					// The id matters: `data` still holds the PREVIOUS order, which may well be paid.
					watcher.start(orderId);
				} else {
					toasts.push('Не удалось открыть страницу оплаты. Разрешите всплывающие окна.', 'danger');
				}
				return;
			}

			// A refusal has something to say again.
			errorDismissed = false;
			await update();
		};
	};
</script>

<svelte:head>
	<title>Главная — VPN</title>
</svelte:head>

<div class="px-5 pt-[max(26px,calc(env(safe-area-inset-top)+26px))] pb-32">
	<WelcomeHeader name={session.user?.firstName ?? null} photoUrl={session.user?.photoUrl ?? null} />

	<!-- Directly under the greeting, the way the reference lays this screen out: what the service is,
	     before what this person currently has. -->
	<FeaturePills />

	<CheckoutStatus {phase} paid={watcher.paid} ondismiss={() => watcher.dismiss()} />

	<CurrentPlanCard
		subscription={data.subscription}
		plan={data.plan}
		trafficUsedBytes={data.trafficUsedBytes}
		onbuy={openBuy}
		onsetup={openSetup}
		onpromo={openPromo}
	/>
</div>

<Sheet
	bind:open={buySheetOpen}
	title={active ? 'Продлить подписку' : 'Выбрать тариф'}
	description="Выберите срок — оплата откроется в браузере."
>
	<!-- Lives inside the sheet, not the page behind it: a refusal happens while buying, and the
	     sheet's own backdrop would otherwise sit on top of a banner rendered underneath it. -->
	{#if form?.message && !errorDismissed}
		<p class="mb-3 rounded-plan bg-danger/15 p-4 text-2xs text-danger" role="alert">
			{form.message}
		</p>
	{/if}

	{#if data.plans.length === 0}
		<EmptyState
			title="Тарифов пока нет"
			description="Мы готовим их прямо сейчас. Загляните чуть позже."
		/>
	{:else}
		{#if promoCode}
			<p class="mb-3 text-2xs text-muted">
				Промокод <span class="font-semibold text-accent">{promoCode}</span> применится к покупке.
			</p>
		{/if}

		<div class="flex flex-col gap-2.5" role="radiogroup" aria-label="Тарифы">
			{#each data.plans as plan (plan.id)}
				<PlanOption
					{plan}
					plans={data.plans}
					selected={plan.id === selectedPlanId}
					onselect={selectPlan}
					disabled={locked}
				/>
			{/each}
		</div>

		<!--
			A form action, not a fetch wrapper (CLAUDE.md 1.5): CSRF by Origin and a working no-JS
			submit come for free. Two fields, and neither is money: the plan id, and the name of a
			promo code. What either is worth is read from the database — there is nowhere here to name
			a price.
		-->
		<form method="POST" action="?/createCheckout" use:enhance={startCheckout} class="mt-5">
			<input type="hidden" name="planId" value={selectedPlanId ?? ''} />
			<input type="hidden" name="promoCode" value={promoCode} />
			<Button
				type="submit"
				class="w-full"
				loading={submitting}
				disabled={selectedPlanId === null || (locked && !submitting)}
				aria-label={selectedPlan ? `Оплатить тариф ${selectedPlan.name}` : 'Оплатить'}
			>
				<CreditCard class="size-[18px]" strokeWidth={2} aria-hidden="true" />
				{active ? 'Продлить' : 'Оплатить'}
			</Button>
		</form>

		{#if extendsUntil}
			<p class="mt-3 text-center text-3xs text-muted">
				Продлит доступ до {formatDateShort(extendsUntil, Date.now())}
			</p>
		{:else}
			<p class="mt-3 text-center text-3xs text-muted">Ключ придёт сразу после оплаты</p>
		{/if}
	{/if}
</Sheet>

<Sheet bind:open={promoSheetOpen} title="Промокод">
	<Input
		bind:value={promoCode}
		aria-label="Промокод"
		placeholder="Промокод"
		maxlength={32}
		uppercase
	/>
	<p class="mt-2 text-2xs text-muted">
		<!-- Honest about where the number appears: the discount is applied when the order is priced,
		     and the amount charged is on the payment page. -->
		Скидка применится к выбранному тарифу на странице оплаты.
	</p>
	<Button class="mt-4 w-full" variant="ghost" onclick={() => (promoSheetOpen = false)}>
		Готово
	</Button>
</Sheet>
