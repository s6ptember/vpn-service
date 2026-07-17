<script lang="ts">
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import CopyField from '$lib/ui/CopyField.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Money from '$lib/ui/Money.svelte';
	import QrCode from '$lib/ui/QrCode.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import Skeleton from '$lib/ui/Skeleton.svelte';
	import Textarea from '$lib/ui/Textarea.svelte';
	import { toasts } from '$lib/ui/toasts.svelte';

	/**
	 * Every primitive from tech.md 12 is rendered here. This page is the contract's shop window:
	 * a slice author reads it instead of inventing a button. Island, Swipeable and Toast are not
	 * repeated — the layout already mounts them around this page, so they are live on screen.
	 */
	let text = $state('');
	let promo = $state('');
	let broken = $state('нет@почты');
	let message = $state('Короткое сообщение');
	let sheetOpen = $state(false);
	let modalOpen = $state(false);
	let loading = $state(false);

	function runLoading() {
		loading = true;
		setTimeout(() => (loading = false), 1200);
	}
</script>

<svelte:head>
	<title>Kitchen sink — VPN</title>
</svelte:head>

<div class="no-scrollbar h-full overflow-y-auto">
	<div class="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-28">
		<h1 class="text-[28px] font-bold tracking-[-.02em]">Kitchen sink</h1>
		<p class="mt-1 text-[14px] text-muted">Все примитивы из tech.md 12. Роут живёт только в dev.</p>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			Button
		</h2>
		<Card>
			<div class="flex flex-wrap items-center gap-2">
				<Button onclick={runLoading}>Купить 30 дней</Button>
				<Button variant="ghost">Применить</Button>
				<Button variant="danger">Отозвать</Button>
			</div>
			<div class="mt-3 flex flex-wrap items-center gap-2">
				<Button size="sm">Продлить</Button>
				<Button size="sm" variant="ghost">Как настроить</Button>
				<Button size="sm" disabled>Недоступно</Button>
				<Button size="sm" {loading}>Загрузка</Button>
			</div>
			<div class="mt-3">
				<Button class="w-full" onclick={runLoading}>Во всю ширину</Button>
			</div>
		</Card>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			Card
		</h2>
		<div class="space-y-3">
			<Card>Обычная карточка</Card>
			<Card interactive onclick={() => toasts.push('Нажали карточку')}>
				Интерактивная карточка: рендерится кнопкой и ловит фокус с клавиатуры
			</Card>
			<Card padded={false}>
				<div class="px-4 py-3 text-[14px]">padded=false — отступы задаёт содержимое</div>
			</Card>
		</div>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			Badge
		</h2>
		<Card>
			<div class="flex flex-wrap items-center gap-2">
				<Badge>neutral</Badge>
				<Badge tone="success">−30%</Badge>
				<Badge tone="warn">скоро истечёт</Badge>
				<Badge tone="danger">просрочен</Badge>
			</div>
		</Card>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			Money
		</h2>
		<Card>
			<div class="flex items-center justify-between text-[15px]">
				<span class="text-muted">Единственное место форматирования цены</span>
				<span class="text-[22px] font-bold"><Money minor={1049} currency="usd" /></span>
			</div>
			<p class="mt-2 text-[13px] text-muted">
				<Money minor={50} currency="eur" /> — минимум списания ·
				<Money minor={49900} currency="usd" /> — крупная сумма
			</p>
		</Card>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			Input
		</h2>
		<div class="space-y-3">
			<Input label="Обычное поле" bind:value={text} placeholder="Введите текст" />
			<Input
				bind:value={promo}
				uppercase
				maxlength={24}
				placeholder="Введите код"
				aria-label="Промокод"
			/>
			<Input label="С ошибкой" bind:value={broken} error="Проверьте адрес: не хватает @" />
		</div>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			Textarea
		</h2>
		<Textarea
			bind:value={message}
			counter
			maxlength={2000}
			rows={4}
			placeholder="Опишите, что случилось"
			aria-label="Сообщение в поддержку"
		/>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			CopyField и QrCode
		</h2>
		<Card>
			<div class="mx-auto w-[140px]">
				<QrCode value="https://sub.local/sub/tg_100000001" />
			</div>
			<p class="mt-2.5 text-center text-[13px] text-muted">Отсканируйте в приложении</p>
			<div class="mt-4">
				<CopyField value="https://sub.local/sub/9f3c1a8e2b7d40569c" label="Ссылка подписки" />
			</div>
		</Card>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			Skeleton
		</h2>
		<Card>
			<Skeleton lines={3} />
			<div class="mt-3"><Skeleton height="3rem" /></div>
		</Card>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			EmptyState
		</h2>
		<EmptyState
			title="Подписки нет"
			description="Выберите тариф — ключ придёт сюда сразу после оплаты."
		>
			{#snippet action()}
				<Button class="w-full">Выбрать тариф</Button>
			{/snippet}
		</EmptyState>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			Toast
		</h2>
		<Card>
			<div class="flex flex-wrap gap-2">
				<Button size="sm" variant="ghost" onclick={() => toasts.push('Ссылка скопирована')}>
					neutral
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onclick={() => toasts.push('Обращение отправлено', 'success')}
				>
					success
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onclick={() => toasts.push('Такого промокода нет', 'danger')}
				>
					danger
				</Button>
			</div>
		</Card>

		<h2 class="mt-7 mb-2 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
			Sheet и Modal
		</h2>
		<Card>
			<div class="flex flex-wrap gap-2">
				<Button size="sm" variant="ghost" onclick={() => (sheetOpen = true)}>Открыть Sheet</Button>
				<Button size="sm" variant="ghost" onclick={() => (modalOpen = true)}>Открыть Modal</Button>
			</div>
		</Card>
	</div>
</div>

<Sheet bind:open={sheetOpen} title="Как подключиться">
	<p class="text-[14px] leading-relaxed text-muted">
		Установите V2Box на iOS или Hiddify на Android, импортируйте ссылку или отсканируйте QR-код.
	</p>
	<div class="mt-4">
		<Button class="w-full" onclick={() => (sheetOpen = false)}>Понятно</Button>
	</div>
</Sheet>

<Modal
	bind:open={modalOpen}
	title="Архивировать тариф?"
	confirmLabel="Архивировать"
	onconfirm={() => toasts.push('Тариф архивирован', 'success')}
>
	<p class="text-[14px] leading-relaxed text-muted">
		Заказы ссылаются на тарифы, поэтому тариф не удаляется, а уходит в архив.
	</p>
</Modal>
