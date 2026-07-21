<script lang="ts">
	import { BookOpen } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import type { SubscriptionDTO } from '$lib/types';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import CopyField from '$lib/ui/CopyField.svelte';
	import QrCode from '$lib/ui/QrCode.svelte';
	import { formatDate } from '../dates';
	import { formatDays } from '../plan-value';

	interface Props {
		subscription: SubscriptionDTO;
		/** Omit it and the card shows no button — the deck itself sells without one. */
		onrenew?: () => void;
	}

	let { subscription, onrenew }: Props = $props();

	/**
	 * `daysLeft` is computed on the server by the one function the expiry notifications will also
	 * use (CLAUDE.md 4). Doing the subtraction again here would be a second implementation, and the
	 * two would disagree on the day somebody is warned.
	 */
	let tone = $derived<'success' | 'warn' | 'danger'>(
		subscription.status !== 'active' ? 'danger' : subscription.daysLeft <= 3 ? 'warn' : 'success'
	);

	let label = $derived(
		subscription.status === 'revoked'
			? 'Отозвана'
			: subscription.status === 'expired'
				? 'Закончилась'
				: `Осталось ${formatDays(subscription.daysLeft)}`
	);
</script>

<Card>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="truncate text-h4 leading-tight font-bold tracking-[-.02em]">
				{subscription.planName}
			</p>
			<p class="mt-1 text-2xs text-muted">
				{subscription.status === 'active' ? 'Действует до' : 'Действовала до'}
				{formatDate(subscription.expiresAt)}
			</p>
		</div>
		<Badge {tone}>{label}</Badge>
	</div>

	{#if subscription.status === 'active'}
		<div class="mt-4 border-t border-line pt-4">
			<!-- The QR is the fast path on a second device; the link is the one that survives a
			     screenshot and a paste into a client app. Both carry the same key. -->
			<QrCode value={subscription.subscriptionUrl} size={160} />

			<div class="mt-4">
				<CopyField value={subscription.subscriptionUrl} label="Ссылка подписки" />
			</div>

			<p class="mt-3.5 text-2xs text-muted">
				Импортируйте ссылку в V2Box на iOS или Hiddify на Android — или отсканируйте QR-код с
				другого устройства.
			</p>
		</div>
	{:else}
		<p class="mt-3.5 text-2xs text-muted">
			Выберите тариф на главной — ключ останется прежним, дни добавятся к подписке.
		</p>
	{/if}

	<!--
		The reference closes this card with the instruction, not with the sell. It only leads while
		access is live: with a lapsed subscription there is nothing to connect, and renewing is the
		only thing left worth offering.
	-->
	<div class="mt-4 grid gap-2.5">
		{#if subscription.status === 'active'}
			<a
				href={resolve('/setup')}
				data-sveltekit-preload-data="tap"
				class="flex w-full press items-center justify-center gap-2 rounded-field bg-accent px-5 py-3.5 text-sm font-bold text-on-accent"
			>
				<BookOpen class="size-[18px]" strokeWidth={2} aria-hidden="true" />
				Инструкция по подключению
			</a>
		{/if}

		{#if onrenew}
			<Button variant="ghost" size="sm" class="w-full" onclick={onrenew}>Продлить</Button>
		{/if}
	</div>
</Card>
