<script lang="ts">
	import type { PlanDTO, SubscriptionDTO } from '$lib/types';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import SectionHeading from '$lib/ui/SectionHeading.svelte';
	import Skeleton from '$lib/ui/Skeleton.svelte';
	import { formatDate } from './dates';
	import { formatDays } from './plan-value';
	import { formatTrafficUsage, trafficUsageRatio } from './traffic';

	interface Props {
		subscription: SubscriptionDTO | null;
		/** The plan behind `subscription`, for its traffic limit. Null exactly when it is. */
		plan: PlanDTO | null;
		trafficUsedBytes: Promise<number | null>;
		/** Opens the sheet holding every purchasable plan. */
		onbuy: () => void;
		/** Before a purchase this is the same sheet as onbuy; after one it is a real page (Главная owns
		 *  the branch, because it is the only place that knows which is true). */
		onsetup: () => void;
		onpromo: () => void;
	}

	let { subscription, plan, trafficUsedBytes, onbuy, onsetup, onpromo }: Props = $props();

	/**
	 * Live access is what this screen is about, so it gets the accent fill and everything else on the
	 * page stays dark — one spotlight per screen (Card's tone contract). An expired or revoked
	 * subscription deliberately loses it: a lapsed plan lit up like the hero reads as working.
	 */
	let highlighted = $derived(subscription?.status === 'active');

	let tone = $derived<'success' | 'warn' | 'danger' | 'neutral'>(
		!subscription
			? 'neutral'
			: subscription.status !== 'active'
				? 'danger'
				: subscription.daysLeft <= 3
					? 'warn'
					: 'success'
	);

	let statusLabel = $derived(
		!subscription
			? 'Статус отсутствует'
			: subscription.status === 'revoked'
				? 'Отозвана'
				: subscription.status === 'expired'
					? 'Закончилась'
					: `Осталось ${formatDays(subscription.daysLeft)}`
	);

	/** Secondary text and rules have to come off the fill, not off the page, once the card is lit. */
	let dimClass = $derived(highlighted ? 'text-on-accent/70' : 'text-muted');
	let ruleClass = $derived(highlighted ? 'border-on-accent/15' : 'border-line');
</script>

<SectionHeading title="Текущий план" />

<Card tone={highlighted ? 'accent' : 'surface'}>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="truncate text-title font-bold tracking-[-.02em]">
				{subscription?.planName ?? 'Нет активного плана'}
			</p>
			{#if subscription}
				<p class={['mt-1.5 text-sm', dimClass]}>
					{subscription.status === 'active' ? 'Действует до' : 'Действовала до'}
					{formatDate(subscription.expiresAt)}
				</p>
			{/if}
		</div>
		<Badge {tone}>{statusLabel}</Badge>
	</div>

	{#if subscription}
		<div class={['mt-4 border-t pt-4', ruleClass]}>
			{#await trafficUsedBytes}
				<Skeleton height="1rem" />
			{:then usedBytes}
				{@const ratio = trafficUsageRatio(usedBytes, plan?.trafficLimitBytes ?? 0)}

				<p class={['text-xs font-medium', dimClass]}>
					{formatTrafficUsage(usedBytes, plan?.trafficLimitBytes ?? 0)}
				</p>

				{#if ratio !== null}
					<!--
						Only drawn when there is a limit to draw against: an unlimited plan has no share
						to fill, and a bar that is always empty would read as "nothing used yet".

						The number is already in the sentence above, so the bar is decoration and stays
						out of the a11y tree rather than repeating it as a second announcement.
					-->
					<div
						class={['mt-2.5 h-1.5 overflow-hidden rounded-full', highlighted ? 'bg-on-accent/20' : 'bg-elevated']}
						aria-hidden="true"
					>
						<div
							class={['h-full rounded-full', highlighted ? 'bg-on-accent' : 'bg-accent-600']}
							style:width="{Math.round(ratio * 100)}%"
						></div>
					</div>
				{/if}
			{/await}
		</div>
	{/if}

	<div class="mt-5 grid gap-2">
		<Button
			variant={highlighted ? 'contrast' : 'primary'}
			class="w-full"
			aria-label="Открыть список тарифов"
			onclick={onbuy}
		>
			{subscription?.status === 'active' ? 'Продлить' : 'Купить'}
		</Button>
		<div class="grid grid-cols-2 gap-2">
			<Button variant="ghost" size="sm" onclick={onsetup}>Установить</Button>
			<Button variant="ghost" size="sm" aria-label="Ввести промокод" onclick={onpromo}>
				Промокоды
			</Button>
		</div>
	</div>
</Card>
