<script lang="ts">
	import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import type { CheckoutPhase } from '$lib/client/checkout.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';

	interface Props {
		phase: CheckoutPhase;
		/** Whether the money actually landed. Only 'timeout' reads differently because of it. */
		paid: boolean;
		ondismiss: () => void;
	}

	let { phase, paid, ondismiss }: Props = $props();

	/**
	 * Every state says what happened and what to do next (tech.md 11). Two rules the copy follows:
	 * a person who has been charged is never told that nothing happened, and a person who has not
	 * been charged is told so plainly — «не списали» is the sentence they are looking for.
	 */
	let copy = $derived.by(() => {
		switch (phase) {
			case 'waiting':
				return {
					tone: 'busy' as const,
					title: 'Ждём оплату',
					text: 'Закончите оплату в браузере. Вернём вас сюда автоматически.'
				};
			case 'granting':
				return {
					tone: 'busy' as const,
					title: 'Оплата прошла',
					text: 'Готовим ключ — это займёт несколько секунд.'
				};
			case 'ready':
				return {
					tone: 'good' as const,
					title: 'Готово',
					text: 'Ключ и QR-код ждут вас в профиле.'
				};
			case 'failed':
				return {
					tone: 'bad' as const,
					title: 'Оплата не прошла',
					text: 'Деньги не списали. Попробуйте ещё раз или выберите другой тариф.'
				};
			case 'canceled':
				return {
					tone: 'bad' as const,
					title: 'Оплата отменена',
					text: 'Ничего не списали. Выберите тариф, когда будете готовы.'
				};
			case 'timeout':
				// The provision job retries with a backoff that can outlast our minute, so a paid
				// order that has not landed yet is late, not lost — and it must not read as a failure.
				return paid
					? {
							tone: 'good' as const,
							title: 'Оплата прошла',
							text: 'Ключ ещё готовится. Пришлём его в Telegram, как только он будет готов.'
						}
					: {
							tone: 'bad' as const,
							title: 'Не дождались оплаты',
							text: 'Если вы оплатили, ключ придёт в Telegram. Если нет — попробуйте ещё раз.'
						};
			default:
				return null;
		}
	});
</script>

{#if copy}
	<!-- A live region: the phase changes while nobody is touching the screen. -->
	<div class="mt-4" role="status" aria-live="polite">
		<Card>
			<div class="flex items-start gap-3">
				{#if copy.tone === 'busy'}
					<span class="spinner mt-0.5 block shrink-0 animate-spin text-accent-600">
						<LoaderCircle size={18} aria-hidden="true" />
					</span>
				{:else if copy.tone === 'good'}
					<CircleCheck class="mt-0.5 size-[18px] shrink-0 text-accent-600" aria-hidden="true" />
				{:else}
					<CircleAlert class="mt-0.5 size-[18px] shrink-0 text-danger-700" aria-hidden="true" />
				{/if}

				<div class="min-w-0 flex-1">
					<p class="text-h3 font-semibold">{copy.title}</p>
					<p class="mt-1.5 text-sm text-muted">{copy.text}</p>

					{#if phase === 'ready'}
						<a
							href={resolve('/profile')}
							data-sveltekit-preload-data="tap"
							class="mt-4 inline-flex h-11 items-center rounded-full bg-accent-600 px-5 text-sm font-semibold text-on-accent press"
						>
							Открыть профиль
						</a>
					{:else if phase !== 'waiting' && phase !== 'granting'}
						<div class="mt-4">
							<Button size="sm" variant="ghost" onclick={ondismiss}>Понятно</Button>
						</div>
					{/if}
				</div>
			</div>
		</Card>
	</div>
{/if}

<style>
	/* The spinner is the only progress signal this card has, so reduced motion slows it rather
	   than stopping it. */
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 1.6s;
		}
	}
</style>
