<script lang="ts">
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import FaqAccordion from './FaqAccordion.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Поддержка — VPN</title>
</svelte:head>

<div class="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-28">
	<h1 class="text-[28px] font-bold tracking-[-.02em]">Поддержка</h1>

	{#if data.faq.length > 0}
		<h2 class="mt-5 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			Частые вопросы
		</h2>

		<FaqAccordion items={data.faq} />
	{:else}
		<!-- Only when the table is genuinely empty: an unseeded install, never a normal one. -->
		<div class="mt-5">
			<EmptyState
				title="Вопросов пока нет"
				description="Ответы появятся здесь. Напишите нам, и мы поможем."
			/>
		</div>
	{/if}
</div>
