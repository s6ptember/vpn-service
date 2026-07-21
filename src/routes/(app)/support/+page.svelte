<script lang="ts">
	import { getContext } from 'svelte';
	import { TELEGRAM_SESSION_KEY, type TelegramSession } from '$lib/client/telegram.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import SectionHeading from '$lib/ui/SectionHeading.svelte';
	import FaqAccordion from './FaqAccordion.svelte';
	import TicketForm from './TicketForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const session = getContext<TelegramSession>(TELEGRAM_SESSION_KEY);
</script>

<svelte:head>
	<title>Поддержка — VPN</title>
</svelte:head>

<div class="px-5 pt-[max(26px,calc(env(safe-area-inset-top)+26px))] pb-32">
	<!-- Centred, the way the reference titles a screen that has no portrait to anchor it. -->
	<h1 class="pb-1 text-center text-title font-bold tracking-[-.02em]">Поддержка</h1>

	{#if data.faq.length > 0}
		<SectionHeading title="Частые вопросы" />

		<FaqAccordion items={data.faq} />
	{/if}

	<SectionHeading title="Написать нам" />

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
