<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import { ChevronRight, LoaderCircle, SlidersHorizontal } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { checkoutWatcher } from '$lib/client/checkout.svelte';
	import { haptic } from '$lib/client/telegram-haptics';
	import { TELEGRAM_SESSION_KEY, type TelegramSession } from '$lib/client/telegram.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import Avatar from './Avatar.svelte';
	import PromoBlock from './PromoBlock.svelte';
	import PurchaseHistory from './PurchaseHistory.svelte';
	import SubscriptionCard from './SubscriptionCard.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const session = getContext<TelegramSession>(TELEGRAM_SESSION_KEY);

	let user = $derived(session.user);
	// Both halves of the name, joined here rather than stored: the DTO keeps them apart because
	// Telegram does, and lastName is optional. A browser visitor with no session gets no name at
	// all — Инкогнито is the honest word for that, not an empty line.
	let fullName = $derived(
		user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : 'Инкогнито'
	);
	// The mock falls back to the Telegram id when somebody has no @username — their own id, shown
	// to them alone, and it beats an empty line under their name. Null hides the line entirely:
	// an anonymous visitor has no handle to show, not an empty one.
	let handle = $derived(
		user ? (user.username ? `@${user.username}` : `ID ${user.telegramId}`) : null
	);

	/**
	 * The watcher is shared with Главная, so a payment started there keeps polling while its person
	 * reads this screen — and its poll is what re-runs this load (both depend on 'app:subscription').
	 */
	$effect(() =>
		checkoutWatcher.attach(() => ({
			subscription: data.subscription,
			latestOrder: data.latestOrder,
			awaitingKey: data.awaitingKey
		}))
	);

	/**
	 * Somebody can also arrive here with the key still being made and no wait running: Telegram
	 * relaunched the app, or they were on Профиль when the money landed. Without this the spinner
	 * below would turn forever — nothing else on this route ever asks the server again, and a mini
	 * app offers no obvious reload gesture.
	 *
	 * untrack keeps the effect from subscribing to `data` through the watcher's own phase, which
	 * would restart the minute on every poll.
	 */
	$effect(() => {
		if (!data.awaitingKey) return;
		untrack(() => {
			if (checkoutWatcher.phase === 'idle') checkoutWatcher.start();
		});
	});

	let waitingPhase = $derived(checkoutWatcher.phase);

	function choosePlan() {
		haptic();
		goto(resolve('/'));
	}
</script>

<svelte:head>
	<title>Профиль — VPN</title>
</svelte:head>

<div class="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-28">
	<h1 class="text-[28px] font-bold tracking-[-.02em]">Профиль</h1>

	<!--
		Shown whether or not anybody is signed in: a browser visitor gets the empty avatar and
		Инкогнито rather than the whole profile disappearing behind a single sign-in banner.
	-->
	<div class="mt-5 flex items-center gap-3">
		<Avatar photoUrl={user?.photoUrl ?? null} firstName={user?.firstName ?? null} />
		<div class="min-w-0">
			<p class="truncate text-[17px] leading-tight font-semibold">{fullName}</p>
			{#if handle}
				<p class="truncate text-[14px] text-muted">{handle}</p>
			{/if}
		</div>
	</div>

	{#if user}
		<PromoBlock result={form} currency={data.currency} />
	{/if}

	<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
		Подписка
	</h2>

	{#if data.subscription}
		<SubscriptionCard subscription={data.subscription} onrenew={choosePlan} />
	{:else if data.awaitingKey}
		<!--
			Paid, and the provision job has not finished. The empty state below must never appear
			here: inviting somebody to buy the thing they just bought is the worst sentence this
			screen could say.
		-->
		<Card>
			<div class="flex items-start gap-3">
				{#if waitingPhase !== 'timeout'}
					<span class="spinner mt-0.5 block shrink-0 animate-spin text-accent-600">
						<LoaderCircle size={18} aria-hidden="true" />
					</span>
				{/if}
				<div class="min-w-0" role="status" aria-live="polite">
					<p class="text-[16px] font-semibold">Оплата прошла</p>
					<p class="mt-1 text-[14px] text-muted">
						{#if waitingPhase === 'timeout'}
							<!-- The provision job retries with a backoff that can outlast our minute. A
							     spinner still turning after that would promise something we cannot time. -->
							Ключ готовится дольше обычного. Пришлём его вам в Telegram, как только он будет готов.
						{:else}
							Готовим ключ. Он появится здесь и придёт вам в Telegram.
						{/if}
					</p>
				</div>
			</div>
		</Card>
	{:else}
		<EmptyState
			title="Подписки нет"
			description={user
				? 'Выберите тариф — ключ придёт сюда сразу после оплаты.'
				: 'Откройте приложение из Telegram и выберите тариф.'}
		>
			{#snippet action()}
				<Button size="sm" class="w-full" onclick={choosePlan}>Выбрать тариф</Button>
			{/snippet}
		</EmptyState>
	{/if}

	{#if data.history.length > 0}
		<!--
			Only once there is something to show. An empty receipts list under a fresh profile is a
			heading explaining that nothing has happened yet, which the empty state above already
			says better.
		-->
		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			История покупок
		</h2>

		<PurchaseHistory orders={data.history} />
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
</div>

<style>
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 1.6s;
		}
	}
</style>
