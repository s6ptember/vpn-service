<script lang="ts">
	import { Check } from 'lucide-svelte';
	import Money from '$lib/ui/Money.svelte';
	import type { PlanDTO } from '$lib/types';

	interface Props {
		plan: PlanDTO;
	}

	let { plan }: Props = $props();

	// Per-day rate stays in minor units so Money remains the only thing that formats a price.
	let perDayMinor = $derived(Math.round(plan.priceMinor / plan.durationDays));

	/**
	 * The mock lists identical bullets on all three cards, so they are product copy, not plan data —
	 * only the traffic line varies, and it is derivable. The mock's "До 3 устройств" is dropped on
	 * purpose: tech.md 17.4 states Marzban gives us no device limit, so it would be a false promise.
	 */
	let features = $derived([
		plan.trafficLimitBytes === 0
			? 'Безлимитный трафик'
			: `${Math.round(plan.trafficLimitBytes / 1024 ** 3)} ГБ трафика`,
		'Все локации',
		'Ключ работает на всех устройствах'
	]);
</script>

<article class="rounded-card bg-surface p-4">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<h3 class="text-[17px] leading-none font-semibold">{plan.name}</h3>
			<p class="mt-1.5 text-[13px] text-muted">
				<Money minor={perDayMinor} currency={plan.currency} /> в день
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
		The mock ends the card with a Купить button. This slice is read-only, so it is omitted rather
		than rendered disabled: a permanently dimmed CTA reads as broken and names an action nobody can
		take. A5 adds it back with the ?/createCheckout action behind it.
	-->
</article>
