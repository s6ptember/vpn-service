<script lang="ts">
	import type { PlanDTO, SubscriptionDTO } from '$lib/types';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import Skeleton from '$lib/ui/Skeleton.svelte';
	import { formatDate } from './dates';
	import { formatDays } from './plan-value';
	import { formatTrafficUsage } from './traffic';

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
</script>

<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
	Текущий план
</h2>

<Card>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="truncate text-[17px] leading-tight font-semibold">
				{subscription?.planName ?? 'Нет активного плана'}
			</p>
			{#if subscription}
				<p class="mt-1 text-[14px] text-muted">
					{subscription.status === 'active' ? 'Действует до' : 'Действовала до'}
					{formatDate(subscription.expiresAt)}
				</p>
			{/if}
		</div>
		<Badge {tone}>{statusLabel}</Badge>
	</div>

	{#if subscription}
		<div class="mt-3.5 border-t border-line pt-3.5">
			{#await trafficUsedBytes}
				<Skeleton height="1rem" />
			{:then usedBytes}
				<p class="text-[13px] text-muted">
					{formatTrafficUsage(usedBytes, plan?.trafficLimitBytes ?? 0)}
				</p>
			{/await}
		</div>
	{/if}

	<div class="mt-4 grid gap-2">
		<Button class="w-full" aria-label="Открыть список тарифов" onclick={onbuy}>Купить</Button>
		<div class="grid grid-cols-2 gap-2">
			<Button variant="ghost" onclick={onsetup}>Установить и настроить</Button>
			<Button variant="ghost" aria-label="Ввести промокод" onclick={onpromo}>Промокоды</Button>
		</div>
	</div>
</Card>
