<script lang="ts">
	import { getContext, untrack } from 'svelte';
	import { LoaderCircle, SlidersHorizontal } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { checkoutWatcher } from '$lib/client/checkout.svelte';
	import { haptic } from '$lib/client/telegram-haptics';
	import { TELEGRAM_SESSION_KEY, type TelegramSession } from '$lib/client/telegram.svelte';
	import Avatar from '$lib/ui/Avatar.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import SectionHeading from '$lib/ui/SectionHeading.svelte';
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
	<!--
		The reference centres this screen's title and hangs its one utility off the corner. The admin
		entrance is that utility: an icon, hidden from everyone else, and that is all the hiding is —
		the guard in hooks.server.ts and the isAdmin check inside every admin action are what actually
		refuse the request (tech.md 9).
	-->
	<div class="relative flex items-center justify-center">
		<h1 class="text-h1 font-bold tracking-[-.02em]">Профиль</h1>

		{#if session.isAdmin}
			<a
				href={resolve('/profile/admin')}
				data-sveltekit-preload-data="tap"
				class="absolute right-0 grid size-11 place-items-center rounded-full bg-surface text-accent-600 press"
				aria-label="Админка"
			>
				<SlidersHorizontal class="size-5" aria-hidden="true" />
			</a>
		{/if}
	</div>

	<!--
		Shown whether or not anybody is signed in: a browser visitor gets the empty avatar and
		Инкогнито rather than the whole profile disappearing behind a single sign-in banner.
	-->
	<div class="mt-8 flex flex-col items-center text-center">
		<Avatar photoUrl={user?.photoUrl ?? null} firstName={user?.firstName ?? null} size="lg" />
		<p class="mt-5 max-w-full truncate text-h1 font-bold tracking-[-.02em] text-accent-600">
			{fullName}
		</p>
		{#if handle}
			<p class="mt-1 max-w-full truncate text-sm text-muted">{handle}</p>
		{/if}
	</div>

	{#if user}
		<PromoBlock result={form} currency={data.currency} />
	{/if}

	<SectionHeading title="Подписка" />

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
					<p class="text-h3 font-semibold">Оплата прошла</p>
					<p class="mt-1.5 text-sm text-muted">
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
		<SectionHeading title="История покупок" />

		<PurchaseHistory orders={data.history} />
	{/if}
</div>

<style>
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 1.6s;
		}
	}
</style>
