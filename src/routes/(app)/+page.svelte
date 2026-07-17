<script lang="ts">
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import PlanCard from './PlanCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Тарифы — VPN</title>
</svelte:head>

<div class="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-28">
	<h1 class="text-[28px] font-bold tracking-[-.02em]">Тарифы</h1>

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
				<PlanCard {plan} />
			{/each}
		</div>

		<p class="mt-4 text-center text-[13px] text-muted">Ключ придёт сразу после оплаты</p>
	{/if}
</div>
