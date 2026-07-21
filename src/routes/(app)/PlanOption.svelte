<script lang="ts">
	import type { PlanDTO } from '$lib/types';
	import Money from '$lib/ui/Money.svelte';
	import { formatDays, formatTraffic, savingsPercent } from './plan-value';

	interface Props {
		plan: PlanDTO;
		/** The whole deck, for the discount baseline. A saving only means something against the others. */
		plans: PlanDTO[];
		selected: boolean;
		onselect: (planId: number) => void;
		/** A checkout is in flight — picking a different plan mid-payment would change what is bought. */
		disabled?: boolean;
	}

	let { plan, plans, selected, onselect, disabled = false }: Props = $props();

	let savings = $derived(savingsPercent(plan, plans));

	/**
	 * tech.md 11 puts the срок on every plan, and `name` is free text: the reference gets away with a
	 * bare «Оптимальный выбор» only because its plans happen to be named after their durations. A
	 * plan called «Стартовый» would otherwise show no duration anywhere, so it leads this line and the
	 * seller's own copy follows it — or the traffic limit, when there is no copy to show.
	 */
	let subtitle = $derived(
		`${formatDays(plan.durationDays)} · ${plan.description ?? formatTraffic(plan.trafficLimitBytes)}`
	);
</script>

<!--
	A radio, not a card with its own buy button. The reference turns the deck into one choice followed
	by one payment: with a button per plan, the deck asks the same question three times and every
	answer is final. `role="radio"` rather than a real <input>, because the whole row is the target
	and the row is what has to carry the state.
-->
<button
	type="button"
	role="radio"
	aria-checked={selected}
	{disabled}
	onclick={() => onselect(plan.id)}
	class={[
		'flex w-full press items-center gap-3.5 rounded-plan border-[1.5px] p-4 text-left',
		selected ? 'border-accent bg-accent/[0.08]' : 'border-line-strong bg-inset',
		disabled && 'opacity-40'
	]}
>
	<!-- Decoration: `aria-checked` on the row is what a screen reader reads, so the dot must not
	     announce itself a second time. -->
	<span
		class={[
			'grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
			selected ? 'border-accent' : 'border-white/[0.28]'
		]}
		aria-hidden="true"
	>
		{#if selected}
			<span class="size-2.5 rounded-full bg-accent"></span>
		{/if}
	</span>

	<span class="min-w-0 flex-1">
		<!-- Free text from the seller, so it wraps rather than truncating. -->
		<span class="block text-body font-bold break-words">{plan.name}</span>
		<span class="mt-0.5 block text-3xs text-muted">{subtitle}</span>
	</span>

	<span class="shrink-0 text-right">
		<span class="block text-h4 font-bold tabular-nums">
			<Money minor={plan.priceMinor} currency={plan.currency} />
		</span>
		{#if savings !== null}
			<span
				class="mt-1 inline-block rounded-full bg-accent/[0.14] px-2 py-0.5 text-4xs font-semibold text-accent tabular-nums"
			>
				−{savings}%
			</span>
		{/if}
	</span>
</button>
