<script lang="ts">
	import { ArrowLeft, Cpu, EyeOff, SlidersHorizontal } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import Avatar from '$lib/ui/Avatar.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import CopyField from '$lib/ui/CopyField.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
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

	/** Every step of the reference type scale, in the order a screen reaches for them. */
	const SCALE = [
		{ token: 'text-display', size: '40px', use: 'Инициал в портрете' },
		{ token: 'text-title', size: '24px', use: 'Заголовок экрана' },
		{ token: 'text-h1', size: '22px', use: 'Имя в профиле' },
		{ token: 'text-h2', size: '20px', use: 'Заголовок карточки' },
		{ token: 'text-h3', size: '19px', use: 'Заголовок секции' },
		{ token: 'text-h4', size: '18px', use: 'Подзаголовок, цена' },
		{ token: 'text-body', size: '17px', use: 'Имя тарифа' },
		{ token: 'text-md', size: '16px', use: 'Заголовок в карточке' },
		{ token: 'text-sm', size: '15px', use: 'Кнопка primary' },
		{ token: 'text-xs', size: '14px', use: 'Кнопка ghost, вопрос FAQ' },
		{ token: 'text-2xs', size: '13px', use: 'Абзац, чип' },
		{ token: 'text-3xs', size: '12px', use: 'Бейдж, подпись' },
		{ token: 'text-4xs', size: '11px', use: 'Тег скидки' }
	];
</script>

<svelte:head>
	<title>Kitchen sink — VPN</title>
</svelte:head>

<div class="no-scrollbar h-full overflow-y-auto">
	<div class="px-5 pt-[max(26px,calc(env(safe-area-inset-top)+26px))] pb-32">
		<h1 class="text-h1 font-bold tracking-[-.02em]">Kitchen sink</h1>
		<p class="mt-1.5 text-2xs text-muted">Все примитивы из tech.md 12. Роут живёт только в dev.</p>

		<SectionHeading title="Типографика" />
		<Card>
			<ul class="list-none space-y-3">
				{#each SCALE as step (step.token)}
					<li class="flex items-baseline justify-between gap-4">
						<span class={[step.token, 'min-w-0 truncate font-bold tracking-[-.02em]']}>
							{step.size}
						</span>
						<span class="shrink-0 text-right text-3xs text-muted">{step.token} · {step.use}</span>
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
				<div class="px-5 py-4 text-2xs">padded=false — отступы задаёт содержимое</div>
			</Card>
		</div>

		<SectionHeading title="Badge" />
		<Card>
			<div class="flex flex-wrap items-center gap-2">
				<Badge>neutral</Badge>
				<Badge tone="success" dot>Активен</Badge>
				<Badge tone="warn">скоро истечёт</Badge>
				<Badge tone="danger">просрочен</Badge>
			</div>
			<p class="mt-3 text-3xs text-muted">
				<code>dot</code> — для статуса, который меняется; факт на карточке идёт без точки.
			</p>
		</Card>

		<SectionHeading title="Chip и IconButton" />
		<Card>
			<div class="flex flex-wrap items-center gap-2">
				<Chip icon={EyeOff}>Без логов</Chip>
				<Chip icon={Cpu}>XRAY</Chip>
				<Chip>Без иконки</Chip>
			</div>
			<div class="mt-4 flex flex-wrap items-center gap-2">
				<IconButton aria-label="Настройки" onclick={() => toasts.push('Нажали кнопку-иконку')}>
					<SlidersHorizontal class="size-[19px]" strokeWidth={1.9} aria-hidden="true" />
				</IconButton>
				<IconButton href={resolve('/')} aria-label="На главную">
					<ArrowLeft class="size-[19px]" strokeWidth={1.9} aria-hidden="true" />
				</IconButton>
			</div>
		</Card>

		<SectionHeading title="Avatar" />
		<Card>
			<div class="flex items-center gap-5">
				<Avatar photoUrl={null} firstName="Женя" />
				<Avatar photoUrl={null} firstName={null} />
				<Avatar photoUrl={null} firstName="Женя" size="lg" />
			</div>
			<p class="mt-3 text-3xs text-muted">
				Инициал, глиф без сессии и портрет профиля в кольце акцента.
			</p>
		</Card>

		<SectionHeading title="Money" />
		<Card>
			<div class="flex items-center justify-between text-2xs">
				<span class="text-muted">Единственное место форматирования цены</span>
				<span class="text-h2 font-bold"><Money minor={1049} currency="usd" /></span>
			</div>
			<p class="mt-2 text-3xs text-muted">
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
			<p class="mt-3 text-center text-3xs text-muted">Отсканируйте в приложении</p>
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

<Sheet
	bind:open={sheetOpen}
	title="Как подключиться"
	description="Ссылка одна и та же — QR просто быстрее на втором устройстве."
>
	<p class="text-2xs leading-relaxed text-muted">
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
	<p class="text-2xs leading-relaxed text-muted">
		Заказы ссылаются на тарифы, поэтому тариф не удаляется, а уходит в архив.
	</p>
</Modal>
