<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import Money from '$lib/ui/Money.svelte';
	import type { Currency } from '$lib/types';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let paying = $state(false);
</script>

<svelte:head>
	<title>Оплата (dev) — VPN</title>
</svelte:head>

<!-- Deliberately plain: this stands in for Stripe's hosted page, and nothing about it ships. -->
<div class="mx-auto max-w-[430px] px-4 py-10">
	<h1 class="text-h1 font-bold tracking-[-.02em]">Оплата</h1>
	<p class="mt-1 text-sm text-muted">Заглушка вместо Stripe. Живёт только в dev.</p>

	<div class="mt-6">
		<Card>
			<p class="text-h3 font-semibold">{data.plan.name}</p>
			<p class="mt-1 text-sm text-muted">Заказ {data.publicId} · {data.status}</p>
			<p class="mt-4 text-h1 leading-none font-bold tabular-nums">
				<Money minor={data.amountMinor} currency={data.currency as Currency} />
			</p>

			{#if form?.message}
				<p class="mt-4 text-sm text-muted" role="status">{form.message}</p>
			{/if}

			<form
				method="POST"
				action="?/pay"
				class="mt-5"
				use:enhance={() => {
					paying = true;
					return async ({ update }) => {
						paying = false;
						await update();
					};
				}}
			>
				<Button type="submit" class="w-full" loading={paying}>Оплатить</Button>
			</form>
		</Card>
	</div>
</div>
