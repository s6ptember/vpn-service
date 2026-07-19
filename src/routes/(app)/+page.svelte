<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { CheckoutWatcher, checkoutReturn } from '$lib/client/checkout.svelte';
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

	/**
	 * The watcher reads the load through a getter rather than a copy: `data` is the single source of
	 * truth, and mirroring it into $state would need an $effect to keep the two in step — the exact
	 * pattern CLAUDE.md 1.1 forbids.
	 */
	const watcher = new CheckoutWatcher(() => ({
		subscription: data.subscription,
		latestOrder: data.latestOrder,
		awaitingKey: data.awaitingKey
	}));

	let phase = $derived(watcher.phase);
	// While a payment is in flight, a second Купить would open a second order for the same person.
	let locked = $derived(submittingPlanId !== null || phase === 'waiting' || phase === 'granting');

	/**
	 * Telegram's start_param is the world outside Svelte, and reading it is a one-time sync on
	 * mount — which is what $effect is for. It says only "a payment attempt just ended": the
	 * publicId inside it is deliberately not matched (see checkout.svelte.ts).
	 */
	$effect(() => {
		const outcome = checkoutReturn(webApp()?.initDataUnsafe?.start_param);

		if (outcome === 'returned') watcher.start();
		if (outcome === 'canceled') watcher.markCanceled();

		// Timers must not outlive the page that started them.
		return () => watcher.stop();
	});

	const startCheckout: SubmitFunction = ({ formData }) => {
		submittingPlanId = Number(formData.get('planId'));

		return async ({ result, update }) => {
			submittingPlanId = null;

			if (result.type === 'success' && typeof result.data?.url === 'string') {
				haptic();

				/**
				 * The payment page opens in a real browser (tech.md 10) and the mini app stays behind
				 * it showing «Ждём оплату». The wait starts only once the link is actually on screen:
				 * a browser that refused to open would leave somebody watching a spinner for a page
				 * they never saw.
				 */
				if (openExternal(result.data.url)) {
					watcher.start();
				} else {
					toasts.push('Не удалось открыть страницу оплаты. Разрешите всплывающие окна.', 'danger');
				}
				return;
			}

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

	{#if form?.message}
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
