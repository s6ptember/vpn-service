<script lang="ts">
	import { getContext } from 'svelte';
	import { TELEGRAM_SESSION_KEY, type TelegramSession } from '$lib/client/telegram.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import FaqAccordion from './FaqAccordion.svelte';
	import TicketForm from './TicketForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const session = getContext<TelegramSession>(TELEGRAM_SESSION_KEY);
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
	{/if}

	<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
		Написать нам
	</h2>

	{#if session.user}
		<TicketForm result={form} />
	{:else}
		<!--
			The splash covers the moment before the cookie lands (tech.md 9), so this is what somebody
			outside Telegram sees: a form that could only ever answer 401 would be the crueller screen.
		-->
		<EmptyState
			title="Форма откроется после входа"
			description="Откройте приложение из Telegram, чтобы написать в поддержку."
		/>
	{/if}
</div>
