<script lang="ts">
	import { BookOpen } from 'lucide-svelte';
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

	let active = $derived(subscription?.status === 'active');

	/**
	 * The tone carries the warning, the word does not: the reference's pill says «Активен» while
	 * access lasts, and a plan with two days left is still active. Turning it amber says the same
	 * thing without writing a second sentence into a pill that has room for one word.
	 */
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
			? 'Нет подписки'
			: subscription.status === 'revoked'
				? 'Отозвана'
				: subscription.status === 'expired'
					? 'Закончилась'
					: 'Активен'
	);

	let statusLine = $derived(
		!subscription
			? 'Выберите тариф, чтобы начать'
			: subscription.status === 'revoked'
				? 'Доступ отозван'
				: subscription.status === 'expired'
					? `Действовала до ${formatDate(subscription.expiresAt)}`
					: `Активен ещё ${formatDays(subscription.daysLeft)}`
	);
</script>

<SectionHeading title="Текущий план" />

<Card>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<!-- Wraps rather than truncates: a plan name is free text and this is the largest type on
			     the card, so an ellipsis here eats most of the word it is naming. -->
			<p class="text-h2 font-bold tracking-[-.02em] break-words">
				{subscription?.planName ?? 'Нет активного плана'}
			</p>
			<p class="mt-1 text-2xs text-muted">{statusLine}</p>
		</div>
		<!-- The pill never wraps, so it must never be squeezed either: the title beside it is what
		     gives, and it has the room to. -->
		<div class="shrink-0">
			<Badge {tone} dot={active}>{statusLabel}</Badge>
		</div>
	</div>

	{#if subscription}
		<div class="mt-4 border-t border-line pt-4">
			{#await trafficUsedBytes}
				<Skeleton height="1rem" />
			{:then usedBytes}
				{@const ratio = trafficUsageRatio(usedBytes, plan?.trafficLimitBytes ?? 0)}

				<p class="text-2xs font-medium text-muted">
					{formatTrafficUsage(usedBytes, plan?.trafficLimitBytes ?? 0)}
				</p>

				{#if ratio !== null}
					<!--
						Only drawn when there is a limit to draw against: an unlimited plan has no share
						to fill, and a bar that is always empty would read as "nothing used yet".

						The number is already in the sentence above, so the bar is decoration and stays
						out of the a11y tree rather than repeating it as a second announcement.
					-->
					<div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden="true">
						<div
							class="h-full rounded-full bg-accent"
							style:width="{Math.round(ratio * 100)}%"
						></div>
					</div>
				{/if}
			{/await}
		</div>
	{/if}

	<!--
		The reference leads this card with the instruction and keeps buying to the pair below it. That
		order only holds once there is access to set up: before a purchase the instruction has nothing
		to explain, so the primary goes back to being the thing that gets somebody a key.
	-->
	<div class="mt-5 grid gap-2.5">
		{#if active}
			<Button class="w-full" onclick={onsetup}>
				<BookOpen class="size-[18px]" strokeWidth={2} aria-hidden="true" />
				Инструкция по подключению
			</Button>
			<div class="grid grid-cols-2 gap-2.5">
				<Button variant="ghost" size="sm" aria-label="Ввести промокод" onclick={onpromo}>
					Промокод
				</Button>
				<Button variant="ghost" size="sm" aria-label="Продлить подписку" onclick={onbuy}>
					Продлить
				</Button>
			</div>
		{:else}
			<Button class="w-full" aria-label="Открыть список тарифов" onclick={onbuy}>Купить</Button>
			<div class="grid grid-cols-2 gap-2.5">
				<Button variant="ghost" size="sm" aria-label="Ввести промокод" onclick={onpromo}>
					Промокод
				</Button>
				<Button variant="ghost" size="sm" onclick={onsetup}>Установить</Button>
			</div>
		{/if}
	</div>
</Card>
