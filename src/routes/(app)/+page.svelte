<script lang="ts">
	import { untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { checkoutWatcher, consumeCheckoutReturn } from '$lib/client/checkout.svelte';
	import { openExternal } from '$lib/client/open-link';
	import { haptic } from '$lib/client/telegram-haptics';
	import { webApp } from '$lib/client/telegram-webapp';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import { toasts } from '$lib/ui/toasts.svelte';
	import CheckoutStatus from './CheckoutStatus.svelte';
	import PlanCard from './PlanCard.svelte';
	import { bestValuePlanId } from './plan-value';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let bestId = $derived(bestValuePlanId(data.plans));

	/** The card whose checkout is in flight. Only one at a time — buying twice is never intended. */
	let submittingPlanId = $state<number | null>(null);

	/** A failed checkout leaves a message on `form`; it must not sit under the next attempt's banner. */
	let errorDismissed = $state(false);

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
	// While a payment is in flight, a second Купить would open a second order for the same person.
	let locked = $derived(submittingPlanId !== null || phase === 'waiting' || phase === 'granting');

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

	const startCheckout: SubmitFunction = ({ formData }) => {
		submittingPlanId = Number(formData.get('planId'));
		// Whatever the last attempt complained about is about to stop being true.
		errorDismissed = true;

		return async ({ result, update }) => {
			submittingPlanId = null;

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
	<title>Тарифы — VPN</title>
</svelte:head>

<div class="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-28">
	<h1 class="text-[28px] font-bold tracking-[-.02em]">Тарифы</h1>

	<CheckoutStatus {phase} paid={watcher.paid} ondismiss={() => watcher.dismiss()} />

	{#if form?.message && !errorDismissed}
		<p class="mt-4 rounded-card bg-surface p-4 text-[14px] text-danger-700" role="alert">
			{form.message}
		</p>
	{/if}

	{#if data.plans.length === 0}
		<div class="mt-4">
			<EmptyState
				title="Тарифов пока нет"
				description="Мы готовим их прямо сейчас. Загляните чуть позже."
			/>
		</div>
	{:else}
		<div class="mt-4 space-y-3">
			{#each data.plans as plan (plan.id)}
				<PlanCard
					{plan}
					best={plan.id === bestId}
					subscription={data.subscription}
					onsubmit={startCheckout}
					busy={submittingPlanId === plan.id}
					{locked}
				/>
			{/each}
		</div>

		<p class="mt-4 text-center text-[13px] text-muted">Ключ придёт сразу после оплаты</p>
	{/if}
</div>
