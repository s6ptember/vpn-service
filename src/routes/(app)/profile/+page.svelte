<script lang="ts">
	import { getContext } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { haptic } from '$lib/client/telegram-haptics';
	import { TELEGRAM_SESSION_KEY, type TelegramSession } from '$lib/client/telegram.svelte';
	import Button from '$lib/ui/Button.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import Avatar from './Avatar.svelte';

	const session = getContext<TelegramSession>(TELEGRAM_SESSION_KEY);

	let user = $derived(session.user);
	// Both halves of the name, joined here rather than stored: the DTO keeps them apart because
	// Telegram does, and lastName is optional.
	let fullName = $derived([user?.firstName, user?.lastName].filter(Boolean).join(' '));
	// The mock falls back to the Telegram id when somebody has no @username — their own id, shown
	// to them alone, and it beats an empty line under their name.
	let handle = $derived(user && (user.username ? `@${user.username}` : `ID ${user.telegramId}`));

	function choosePlan() {
		haptic();
		goto(resolve('/'));
	}
</script>

<svelte:head>
	<title>Профиль — VPN</title>
</svelte:head>

<!-- A9 fills the subscription card in with the real plan, QR and link; A10 adds the promo block,
     A12 the purchase history. -->
<div class="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-28">
	<h1 class="text-[28px] font-bold tracking-[-.02em]">Профиль</h1>

	{#if user}
		<div class="mt-5 flex items-center gap-3">
			<Avatar photoUrl={user.photoUrl} firstName={user.firstName} />
			<div class="min-w-0">
				<p class="truncate text-[17px] leading-tight font-semibold">{fullName}</p>
				<p class="truncate text-[14px] text-muted">{handle}</p>
			</div>
		</div>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			Подписка
		</h2>

		<EmptyState
			title="Подписки нет"
			description="Выберите тариф — ключ придёт сюда сразу после оплаты."
		>
			{#snippet action()}
				<Button size="sm" class="w-full" onclick={choosePlan}>Выбрать тариф</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="mt-5">
			<EmptyState
				title="Профиль откроется после входа"
				description="Откройте приложение из Telegram, чтобы увидеть свою подписку."
			/>
		</div>
	{/if}
</div>
