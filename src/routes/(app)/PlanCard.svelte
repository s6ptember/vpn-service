<script lang="ts">
	import { Check } from 'lucide-svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import Money from '$lib/ui/Money.svelte';
	import type { PlanDTO } from '$lib/types';
	import { formatDays, perDayMinor } from './plan-value';

	interface Props {
		plan: PlanDTO;
		/** Lowest daily rate in the deck. Derived by the page, never stored (see plan-value.ts). */
		best?: boolean;
	}

	let { plan, best = false }: Props = $props();

	let perDay = $derived(perDayMinor(plan));

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
		plan.trafficLimitBytes === 0
			? 'Безлимитный трафик'
			: `${Math.round(plan.trafficLimitBytes / 1024 ** 3)} ГБ трафика`,
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

	<!--
		The mock ends the card with a Купить button. This slice still sells nothing, so it is omitted
		rather than rendered disabled: a permanently dimmed CTA reads as broken and names an action
		nobody can take. A5 adds it back with the ?/createCheckout action behind it, and A8 adds the
		"продлит до <дата>" line — a subscription cannot exist before that job writes one.
	-->
</article>
