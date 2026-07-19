<script lang="ts">
	import { getContext } from 'svelte';
	import { ChevronRight, LoaderCircle, SlidersHorizontal } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { haptic } from '$lib/client/telegram-haptics';
	import { TELEGRAM_SESSION_KEY, type TelegramSession } from '$lib/client/telegram.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import Avatar from './Avatar.svelte';
	import SubscriptionCard from './SubscriptionCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

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

<!-- A10 adds the promo block, A12 the purchase history. -->
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

		{#if data.subscription}
			<SubscriptionCard subscription={data.subscription} />
		{:else if data.awaitingKey}
			<!--
				Paid, and the provision job has not finished. The empty state below must never appear
				here: inviting somebody to buy the thing they just bought is the worst sentence this
				screen could say.
			-->
			<Card>
				<div class="flex items-start gap-3">
					<span class="spinner mt-0.5 block shrink-0 animate-spin text-accent-600">
						<LoaderCircle size={18} aria-hidden="true" />
					</span>
					<div class="min-w-0" role="status" aria-live="polite">
						<p class="text-[16px] font-semibold">Оплата прошла</p>
						<p class="mt-1 text-[14px] text-muted">
							Готовим ключ. Он появится здесь и придёт вам в Telegram.
						</p>
					</div>
				</div>
			</Card>
		{:else}
			<EmptyState
				title="Подписки нет"
				description="Выберите тариф — ключ придёт сюда сразу после оплаты."
			>
				{#snippet action()}
					<Button size="sm" class="w-full" onclick={choosePlan}>Выбрать тариф</Button>
				{/snippet}
			</EmptyState>
		{/if}

		{#if session.isAdmin}
			<!--
				The entrance is hidden from everyone else, and that is all it is: the guard in
				hooks.server.ts and the isAdmin check inside every admin action are what actually
				refuse the request (tech.md 9).
			-->
			<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
				Управление
			</h2>

			<Card padded={false}>
				<a
					href={resolve('/profile/admin')}
					data-sveltekit-preload-data="tap"
					class="flex items-center gap-3 p-4 press"
				>
					<SlidersHorizontal class="size-5 shrink-0 text-accent-600" aria-hidden="true" />
					<span class="min-w-0 flex-1 text-[15px] font-medium">Админка</span>
					<ChevronRight class="size-4 shrink-0 text-muted" aria-hidden="true" />
				</a>
			</Card>
		{/if}
	{:else}
		<div class="mt-5">
			<EmptyState
				title="Профиль откроется после входа"
				description="Откройте приложение из Telegram, чтобы увидеть свою подписку."
			/>
		</div>
	{/if}
</div>

<style>
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 1.6s;
		}
	}
</style>
