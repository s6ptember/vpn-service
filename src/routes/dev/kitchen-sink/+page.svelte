<script lang="ts">
	import Avatar from '$lib/ui/Avatar.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import CopyField from '$lib/ui/CopyField.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Money from '$lib/ui/Money.svelte';
	import QrCode from '$lib/ui/QrCode.svelte';
	import SectionHeading from '$lib/ui/SectionHeading.svelte';
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

	/** The nine steps of the reference type scale, in the order a screen reaches for them. */
	const SCALE = [
		{ token: 'text-display', size: '35px', use: 'Цена на карточке тарифа' },
		{ token: 'text-title', size: '31px', use: 'Имя текущего плана' },
		{ token: 'text-h1', size: '27px', use: 'Заголовок экрана' },
		{ token: 'text-h2', size: '21px', use: 'Заголовок секции' },
		{ token: 'text-h3', size: '19px', use: 'Заголовок карточки' },
		{ token: 'text-body', size: '17px', use: 'Основной текст' },
		{ token: 'text-sm', size: '15px', use: 'Вторичный текст' },
		{ token: 'text-xs', size: '12px', use: 'Подписи и пилюли' },
		{ token: 'text-2xs', size: '11px', use: 'Самое мелкое' }
	];
</script>

<svelte:head>
	<title>Kitchen sink — VPN</title>
</svelte:head>

<div class="no-scrollbar h-full overflow-y-auto">
	<div class="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-28">
		<h1 class="text-h1 font-bold tracking-[-.02em]">Kitchen sink</h1>
		<p class="mt-1.5 text-sm text-muted">Все примитивы из tech.md 12. Роут живёт только в dev.</p>

		<SectionHeading title="Типографика" />
		<Card>
			<ul class="list-none space-y-3">
				{#each SCALE as step (step.token)}
					<li class="flex items-baseline justify-between gap-4">
						<span class={[step.token, 'min-w-0 truncate font-bold tracking-[-.02em]']}>
							{step.size}
						</span>
						<span class="shrink-0 text-right text-xs text-muted">{step.token} · {step.use}</span>
					</li>
				{/each}
			</ul>
		</Card>

		<SectionHeading title="Button" />
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

		<SectionHeading title="Card" />
		<div class="space-y-3">
			<Card>Обычная карточка</Card>
			<Card interactive onclick={() => toasts.push('Нажали карточку')}>
				Интерактивная карточка: рендерится кнопкой и ловит фокус с клавиатуры
			</Card>
			<Card padded={false}>
				<div class="px-5 py-4 text-sm">padded=false — отступы задаёт содержимое</div>
			</Card>
			<!-- The one card per screen that gets the accent. Its button and badges switch to the
			     contrast variants, because a primary button here would be accent on accent. -->
			<Card tone="accent">
				<p class="text-h3 font-bold">tone="accent" — прожектор экрана</p>
				<p class="mt-1.5 text-sm text-on-accent/70">
					Текст уходит в near-black, вторичный — в on-accent/70.
				</p>
				<div class="mt-4 flex flex-wrap gap-2">
					<Badge tone="contrast">30 дней</Badge>
					<Badge tone="contrast">Безлимит</Badge>
				</div>
				<Button variant="contrast" class="mt-4 w-full">Продлить</Button>
			</Card>
		</div>

		<SectionHeading title="Badge" />
		<Card>
			<div class="flex flex-wrap items-center gap-2">
				<Badge>neutral</Badge>
				<Badge tone="success">−30%</Badge>
				<Badge tone="warn">скоро истечёт</Badge>
				<Badge tone="danger">просрочен</Badge>
			</div>
			<p class="mt-3 text-xs text-muted">
				Тон <code>contrast</code> живёт только на акцентной карточке — он выше, в разделе Card.
			</p>
		</Card>

		<SectionHeading title="Avatar" />
		<Card>
			<div class="flex items-center gap-5">
				<Avatar photoUrl={null} firstName="Женя" />
				<Avatar photoUrl={null} firstName={null} />
				<Avatar photoUrl={null} firstName="Женя" size="lg" />
			</div>
			<p class="mt-3 text-xs text-muted">
				Инициал, глиф без сессии и портрет профиля в кольце акцента.
			</p>
		</Card>

		<SectionHeading title="Money" />
		<Card>
			<div class="flex items-center justify-between text-sm">
				<span class="text-muted">Единственное место форматирования цены</span>
				<span class="text-title font-bold"><Money minor={1049} currency="usd" /></span>
			</div>
			<p class="mt-2 text-xs text-muted">
				<Money minor={50} currency="eur" /> — минимум списания ·
				<Money minor={49900} currency="usd" /> — крупная сумма
			</p>
		</Card>

		<SectionHeading title="Input" />
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

		<SectionHeading title="Textarea" />
		<Textarea
			bind:value={message}
			counter
			maxlength={2000}
			rows={4}
			placeholder="Опишите, что случилось"
			aria-label="Сообщение в поддержку"
		/>

		<SectionHeading title="CopyField и QrCode" />
		<Card>
			<QrCode value="https://sub.local/sub/tg_100000001" size={180} />
			<p class="mt-3 text-center text-xs text-muted">Отсканируйте в приложении</p>
			<div class="mt-4">
				<CopyField value="https://sub.local/sub/9f3c1a8e2b7d40569c" label="Ссылка подписки" />
			</div>
		</Card>

		<SectionHeading title="Skeleton" />
		<Card>
			<Skeleton lines={3} />
			<div class="mt-3"><Skeleton height="3rem" /></div>
		</Card>

		<SectionHeading title="EmptyState" />
		<EmptyState
			title="Подписки нет"
			description="Выберите тариф — ключ придёт сюда сразу после оплаты."
		>
			{#snippet action()}
				<Button class="w-full">Выбрать тариф</Button>
			{/snippet}
		</EmptyState>

		<SectionHeading title="Toast" />
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

		<SectionHeading title="Sheet и Modal" />
		<Card>
			<div class="flex flex-wrap gap-2">
				<Button size="sm" variant="ghost" onclick={() => (sheetOpen = true)}>Открыть Sheet</Button>
				<Button size="sm" variant="ghost" onclick={() => (modalOpen = true)}>Открыть Modal</Button>
			</div>
		</Card>
	</div>
</div>

<Sheet bind:open={sheetOpen} title="Как подключиться">
	<p class="text-sm leading-relaxed text-muted">
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
	<p class="text-sm leading-relaxed text-muted">
		Заказы ссылаются на тарифы, поэтому тариф не удаляется, а уходит в архив.
	</p>
</Modal>
