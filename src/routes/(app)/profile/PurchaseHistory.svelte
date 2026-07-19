<script lang="ts">
	import Badge from '$lib/ui/Badge.svelte';
	import Card from '$lib/ui/Card.svelte';
	import Money from '$lib/ui/Money.svelte';
	import type { OrderDTO, OrderStatus } from '$lib/types';
	import { formatDate } from '../dates';

	interface Props {
		/** Newest first, as the reader returns them. */
		orders: OrderDTO[];
	}

	let { orders }: Props = $props();

	/**
	 * Statuses come from $lib/types, never as literals in markup (CLAUDE.md 4). A paid order is the
	 * ordinary case and says nothing: a badge on every row would be noise, and the date already tells
	 * the person it went through.
	 */
	const LABELS: Record<Exclude<OrderStatus, 'paid'>, { text: string; tone: 'warn' | 'neutral' }> = {
		pending: { text: 'Ждём оплату', tone: 'warn' },
		failed: { text: 'Не прошла', tone: 'neutral' },
		canceled: { text: 'Отменён', tone: 'neutral' }
	};

	const labelOf = (status: OrderStatus) => (status === 'paid' ? null : LABELS[status]);

	/**
	 * When it happened: the moment the money moved, or — for an attempt that never got that far — the
	 * moment it was opened. Both are real instants, so both are shown in the reader's own timezone.
	 */
	const dateOf = (order: OrderDTO) => order.paidAt ?? order.createdAt;
</script>

<Card padded={false}>
	<ul>
		{#each orders as order, i (order.id)}
			<li class={['flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-line']}>
				<div class="min-w-0 flex-1">
					<!-- The snapshot, not the live plan (tech.md 5): a receipt describes what was actually
					     bought, not what the plan has been renamed or repriced to since. -->
					<p class="text-[15px] leading-tight font-medium">{order.plan.name}</p>
					<p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
						{formatDate(dateOf(order))}
						{#if labelOf(order.status)}
							{@const label = labelOf(order.status)!}
							<Badge tone={label.tone}>{label.text}</Badge>
						{/if}
					</p>
				</div>
				<p class="shrink-0 text-[15px] font-medium tabular-nums">
					<Money minor={order.finalPriceMinor} currency={order.currency} />
				</p>
			</li>
		{/each}
	</ul>
</Card>
