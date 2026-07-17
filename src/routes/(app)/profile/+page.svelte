<script lang="ts">
	import { getContext } from 'svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import { TELEGRAM_SESSION_KEY, type TelegramSession } from '$lib/client/telegram.svelte';

	const session = getContext<TelegramSession>(TELEGRAM_SESSION_KEY);
</script>

<svelte:head>
	<title>Профиль — VPN</title>
</svelte:head>

<!-- Shell only: A2 fills in avatar and name, A9 the active plan, QR and link, A12 the history. -->
<div class="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-28">
	<h1 class="text-[28px] font-bold tracking-[-.02em]">Профиль</h1>

	<div class="mt-5">
		{#if session.user}
			<EmptyState
				title="Подписки нет"
				description="Выберите тариф — ключ придёт сюда сразу после оплаты."
			/>
		{:else}
			<EmptyState
				title="Профиль откроется после входа"
				description="Откройте приложение из Telegram, чтобы увидеть свою подписку."
			/>
		{/if}
	</div>
</div>
