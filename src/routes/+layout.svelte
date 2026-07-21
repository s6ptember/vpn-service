<script lang="ts">
	import '../app.css';
	import { setContext } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { TELEGRAM_SESSION_KEY, TelegramSession } from '$lib/client/telegram.svelte';
	import Island from '$lib/ui/Island.svelte';
	import Swipeable from '$lib/ui/Swipeable.svelte';
	import Toast from '$lib/ui/Toast.svelte';
	import { SECTIONS, indexOfPath, sectionOfPath } from '$lib/ui/nav';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const session = new TelegramSession(() => data.user);
	setContext(TELEGRAM_SESSION_KEY, session);

	// /dev/kitchen-sink shares this layout but is not part of the deck: it must not get the island,
	// and a swipe there must not fling the reader to /support.
	let section = $derived(sectionOfPath(page.url.pathname));
	let activeIndex = $derived(indexOfPath(page.url.pathname));

	// The Telegram WebApp API is the world outside Svelte, which is what $effect is for. `void`:
	// an effect must return a cleanup function or nothing, never a promise.
	$effect(() => {
		void session.init();
	});

	function navigate(next: number) {
		goto(resolve(SECTIONS[next].href));
	}
</script>

<!-- md: the phone frame is a desktop convenience; the mini app itself is the 460px column. -->
<div
	class="relative mx-auto h-[100dvh] w-full max-w-[460px] overflow-hidden bg-page md:h-[880px] md:max-h-[calc(100dvh-48px)] md:rounded-[40px] md:shadow-[0_40px_80px_-20px_rgba(0,0,0,.55)]"
>
	{#if section}
		<Swipeable index={activeIndex} count={SECTIONS.length} onnavigate={navigate}>
			{@render children()}
		</Swipeable>

		<Island sections={SECTIONS} {activeIndex} />
	{:else}
		{@render children()}
	{/if}

	<Toast />

	{#if !session.ready}
		<!-- Covers the app until the handshake settles, so nobody sees a half-empty screen first.
		     It is server-rendered and detaches on mount, so its absence is also the signal that the
		     app has hydrated — e2e waits on it rather than racing the pointer listeners. -->
		<div
			data-splash
			class="absolute inset-0 z-50 grid place-items-center bg-page"
			aria-hidden="true"
		>
			<div
				class="size-8 animate-spin rounded-full border-2 border-line-strong border-t-accent"
			></div>
		</div>
	{/if}
</div>
