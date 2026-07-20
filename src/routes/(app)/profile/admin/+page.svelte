<script lang="ts">
	import { ChevronDown, Plus } from 'lucide-svelte';
	import { enhance } from '$app/forms';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Money from '$lib/ui/Money.svelte';
	import type { TicketStatus } from '$lib/types';
	import { formatDate, formatDateUtc } from '../../dates';
	import { formatDays, formatTraffic } from '../../plan-value';
	import PlanForm from './PlanForm.svelte';
	import PromoForm from './PromoForm.svelte';
	import ReconcileForm from './ReconcileForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * A16 — how a ticket's state reads to an admin. Both maps are keyed by the union from
	 * `$lib/types`, so a status added to the contract fails the typecheck here instead of rendering
	 * as a blank badge (CLAUDE.md 4: no status literals loose in the markup).
	 */
	const TICKET_LABEL: Record<TicketStatus, string> = {
		new: 'В очереди',
		delivered: 'Доставлено',
		failed: 'Не дошло'
	};

	const TICKET_TONE: Record<TicketStatus, 'neutral' | 'success' | 'danger'> = {
		new: 'neutral',
		delivered: 'success',
		failed: 'danger'
	};

	let creating = $state(false);
	let creatingPromo = $state(false);
	/** What the confirmation is about, and the form that will do the writing if it is confirmed. */
	let archiving = $state<{ body: string; form: HTMLFormElement } | null>(null);
	let confirmOpen = $state(false);

	/**
	 * An answer belongs to exactly one form; every other block stays quiet. Both halves of the target
	 * are compared — plans and promo codes number themselves independently, so an answer about promo 3
	 * must not surface under plan 3.
	 */
	const answerFor = (kind: 'plan' | 'promo' | 'reconcile', id: number | null) =>
		form?.target.kind === kind && form.target.id === id ? form : null;

	let listed = $derived(new Set(data.plans.map((plan) => plan.id)));
	let listedPromos = $derived(new Set(data.promoCodes.map((promo) => promo.id)));

	/**
	 * Whether the block that owns the answer is on screen to show it. Archiving is the case that
	 * needs this: the plan it reports on is gone from the list by the time the answer arrives, so
	 * without a page-level line the admin would click "В архив" and see nothing happen at all.
	 */
	let answerHasHome = $derived.by(() => {
		if (!form) return true;

		const { kind, id } = form.target;
		switch (kind) {
			case 'plan':
				return id === null ? creating : listed.has(id);
			case 'promo':
				return id === null ? creatingPromo : listedPromos.has(id);
			// The reconcile form is always on screen, so its answer always has somewhere to land.
			case 'reconcile':
				return true;
		}
	});

	let banner = $derived(answerHasHome ? null : (form?.message ?? null));

	/** The reconcile section has one form, so its answer needs no id to be routed by. */
	let reconcileAnswer = $derived(answerFor('reconcile', null));

	/** Red is for refusals. A confirmation in the error colour reads as a failure. */
	const tone = (ok: boolean) => (ok ? 'text-muted' : 'text-danger-700');

	/**
	 * The validity window in one line. Both columns are nullable and each combination means something
	 * different, so the four cases are spelled out rather than joined with a dash around empty strings.
	 *
	 * UTC, because that is how the window was written: PromoForm's date inputs speak calendar days and
	 * the parser stores them as UTC boundaries. Read locally, this line would show a date the admin
	 * never typed.
	 */
	function formatPromoWindow(from: number | null, until: number | null): string {
		if (from === null && until === null) return 'Работает без ограничения по времени';
		if (from === null) return `До ${formatDateUtc(until!)}`;
		if (until === null) return `С ${formatDateUtc(from)}`;
		return `${formatDateUtc(from)} — ${formatDateUtc(until)}`;
	}

	/**
	 * Intercepts the archive submit so the dialog can ask first. Without JS the button submits its
	 * own form directly: no confirmation step, but the write still works.
	 */
	function askArchive(event: MouseEvent, body: string) {
		const form = (event.currentTarget as HTMLElement).closest('form');
		if (!form) return;

		event.preventDefault();
		archiving = { body, form };
		confirmOpen = true;
	}
</script>

<svelte:head>
	<title>Админка — VPN</title>
</svelte:head>

<div class="px-4 pt-[max(16px,env(safe-area-inset-top))] pb-28">
	<h1 class="text-[28px] font-bold tracking-[-.02em]">Админка</h1>

	{#if banner}
		<p class="mt-4 rounded-card bg-surface p-4 text-[14px]" role="status">{banner}</p>
	{/if}

	<div class="mt-5 flex items-center justify-between gap-3">
		<h2 class="px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">Тарифы</h2>
		<Button
			size="sm"
			variant="ghost"
			onclick={() => (creating = !creating)}
			aria-label={creating ? 'Свернуть форму нового тарифа' : 'Создать тариф'}
		>
			<span class="flex items-center gap-1.5">
				<Plus class="size-4" aria-hidden="true" />
				Новый
			</span>
		</Button>
	</div>

	{#if creating}
		{@const answer = answerFor('plan', null)}

		<div class="mt-3">
			<Card>
				{#if answer?.message}
					<p class={['mb-3 text-[14px]', tone(answer.ok)]}>{answer.message}</p>
				{/if}

				<PlanForm
					action="?/create"
					currency={data.currency}
					errors={answer?.errors ?? {}}
					values={answer?.values ?? {}}
					submitLabel="Создать тариф"
				/>
			</Card>
		</div>
	{/if}

	{#if data.plans.length === 0}
		<div class="mt-3">
			<EmptyState
				title="Тарифов нет"
				description="Создайте первый — он сразу появится на главной."
			/>
		</div>
	{:else}
		<div class="mt-3 space-y-3">
			{#each data.plans as plan (plan.id)}
				{@const answer = answerFor('plan', plan.id)}

				<Card>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="text-[17px] leading-none font-semibold">{plan.name}</h3>
								{#if !plan.isActive}
									<Badge tone="warn">Скрыт</Badge>
								{/if}
							</div>
							<p class="mt-1.5 text-[13px] text-muted">
								{formatDays(plan.durationDays)} · {formatTraffic(plan.trafficLimitBytes)} · порядок {plan.sortOrder}
							</p>
						</div>
						<p class="shrink-0 text-[17px] leading-none font-bold tabular-nums">
							<Money minor={plan.priceMinor} currency={plan.currency} />
						</p>
					</div>

					{#if answer?.message}
						<p class={['mt-3 text-[14px]', tone(answer.ok)]}>{answer.message}</p>
					{/if}

					<details class="group mt-3 border-t border-line pt-3">
						<summary
							class="flex cursor-pointer list-none items-center justify-between text-[15px] font-medium press"
						>
							Изменить
							<!-- The chevron follows the panel: a static one over an open panel is a lie. -->
							<ChevronDown
								class="size-4 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
								aria-hidden="true"
							/>
						</summary>

						<div class="mt-3">
							<PlanForm
								action="?/update"
								{plan}
								currency={data.currency}
								errors={answer?.errors ?? {}}
								values={answer?.values ?? {}}
								submitLabel="Сохранить"
							/>

							<!--
								A real form, not a fetch: the dialog only asks, this is what writes. The submit
								button carries the id, so with scripting off it still archives — the confirmation
								step is the enhancement, not the mechanism.
							-->
							<form method="POST" action="?/archive" use:enhance class="mt-3">
								<input type="hidden" name="id" value={plan.id} />
								<Button
									type="submit"
									variant="danger"
									size="sm"
									class="w-full"
									onclick={(event) =>
										askArchive(
											event,
											`«${plan.name}» пропадёт с главной и из этого списка. Прошлые заказы останутся, вернуть тариф обратно нельзя.`
										)}
									aria-label="Отправить тариф {plan.name} в архив"
								>
									В архив
								</Button>
							</form>
						</div>
					</details>
				</Card>
			{/each}
		</div>
	{/if}

	<p class="mt-4 px-1 text-[13px] text-muted">
		Тарифы не удаляются: заказы ссылаются на них, поэтому архивный тариф просто исчезает из списка и
		с главной.
	</p>

	<!-- A11 — promo codes. Same shape as the plans above: create, edit inline, archive. -->
	<div class="mt-8 flex items-center justify-between gap-3">
		<h2 class="px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">Промокоды</h2>
		<Button
			size="sm"
			variant="ghost"
			onclick={() => (creatingPromo = !creatingPromo)}
			aria-label={creatingPromo ? 'Свернуть форму нового промокода' : 'Создать промокод'}
		>
			<span class="flex items-center gap-1.5">
				<Plus class="size-4" aria-hidden="true" />
				Новый
			</span>
		</Button>
	</div>

	{#if creatingPromo}
		{@const answer = answerFor('promo', null)}

		<div class="mt-3">
			<Card>
				{#if answer?.message}
					<p class={['mb-3 text-[14px]', tone(answer.ok)]}>{answer.message}</p>
				{/if}

				<PromoForm
					action="?/createPromo"
					currency={data.currency}
					errors={answer?.errors ?? {}}
					values={answer?.values ?? {}}
					submitLabel="Создать промокод"
				/>
			</Card>
		</div>
	{/if}

	{#if data.promoCodes.length === 0}
		<div class="mt-3">
			<EmptyState
				title="Промокодов нет"
				description="Создайте первый — его сразу можно будет применить при покупке."
			/>
		</div>
	{:else}
		<div class="mt-3 space-y-3">
			{#each data.promoCodes as promo (promo.id)}
				{@const answer = answerFor('promo', promo.id)}
				{@const spent = promo.maxUses !== null && promo.usedCount >= promo.maxUses}

				<Card>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="text-[17px] leading-none font-semibold tracking-[.04em]">
									{promo.code}
								</h3>
								{#if !promo.isActive}
									<Badge tone="warn">Выключен</Badge>
								{:else if spent}
									<!-- Still switched on, and it refuses every customer: worth saying out loud. -->
									<Badge tone="neutral">Разобрали</Badge>
								{/if}
							</div>
							<p class="mt-1.5 text-[13px] text-muted">
								{formatPromoWindow(promo.validFrom, promo.validUntil)}
							</p>
						</div>
						<div class="shrink-0 text-right">
							<p class="text-[17px] leading-none font-bold tabular-nums">
								{#if promo.discountType === 'percent'}
									−{promo.discountValue}%
								{:else}
									−<Money minor={promo.discountValue} currency={data.currency} />
								{/if}
							</p>
							<p class="mt-1.5 text-[13px] text-muted tabular-nums">
								{promo.usedCount} / {promo.maxUses ?? '∞'}
							</p>
						</div>
					</div>

					{#if answer?.message}
						<p class={['mt-3 text-[14px]', tone(answer.ok)]}>{answer.message}</p>
					{/if}

					<details class="group mt-3 border-t border-line pt-3">
						<summary
							class="flex cursor-pointer list-none items-center justify-between text-[15px] font-medium press"
						>
							Изменить
							<ChevronDown
								class="size-4 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
								aria-hidden="true"
							/>
						</summary>

						<div class="mt-3">
							<PromoForm
								action="?/updatePromo"
								{promo}
								currency={data.currency}
								errors={answer?.errors ?? {}}
								values={answer?.values ?? {}}
								submitLabel="Сохранить"
							/>

							<form method="POST" action="?/archivePromo" use:enhance class="mt-3">
								<input type="hidden" name="id" value={promo.id} />
								<Button
									type="submit"
									variant="danger"
									size="sm"
									class="w-full"
									onclick={(event) =>
										askArchive(
											event,
											`«${promo.code}» перестанет работать у всех. Прошлые заказы и применения останутся, вернуть промокод обратно нельзя.`
										)}
									aria-label="Отправить промокод {promo.code} в архив"
								>
									В архив
								</Button>
							</form>
						</div>
					</details>
				</Card>
			{/each}
		</div>
	{/if}

	<p class="mt-4 px-1 text-[13px] text-muted">
		Использование засчитывается после оплаты. Один промокод применяется один раз на человека.
	</p>

	<!-- A16 — operations: what people asked, what broke, and the one repair an admin can run. -->
	<h2 class="mt-8 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
		Обращения
	</h2>

	{#if data.tickets.length === 0}
		<div class="mt-3">
			<EmptyState
				title="Обращений нет"
				description="Здесь появятся последние письма из поддержки."
			/>
		</div>
	{:else}
		<div class="mt-3 space-y-3">
			{#each data.tickets as ticket (ticket.id)}
				<Card>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="text-[15px] leading-none font-semibold">#{ticket.id}</h3>
								<Badge tone={TICKET_TONE[ticket.status]}>{TICKET_LABEL[ticket.status]}</Badge>
							</div>
							<p class="mt-1.5 text-[13px] text-muted">
								{ticket.author.name}
								{#if ticket.author.username}
									· @{ticket.author.username}
								{:else}
									· ID {ticket.author.telegramId}
								{/if}
							</p>
						</div>
						<p class="shrink-0 text-[13px] text-muted tabular-nums">
							{formatDate(ticket.createdAt)}
						</p>
					</div>

					<p class="mt-3 text-[14px] break-words">{ticket.excerpt}</p>
				</Card>
			{/each}
		</div>
	{/if}

	<p class="mt-4 px-1 text-[13px] text-muted">
		Текст письма целиком приходит в личку — здесь только начало, чтобы узнать обращение.
	</p>

	<h2 class="mt-8 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
		Упавшие джобы
	</h2>

	{#if data.failedJobs.length === 0}
		<div class="mt-3">
			<EmptyState
				title="Упавших джобов нет"
				description="Очередь разобрала всё, что в неё клали."
			/>
		</div>
	{:else}
		<div class="mt-3 space-y-3">
			{#each data.failedJobs as job (job.id)}
				<Card>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<h3 class="text-[15px] leading-none font-semibold break-all">{job.type}</h3>
							<p class="mt-1.5 text-[13px] text-muted tabular-nums">
								#{job.id} · попыток {job.attempts} из {job.maxAttempts}
							</p>
						</div>
						<p class="shrink-0 text-[13px] text-muted tabular-nums">{formatDate(job.updatedAt)}</p>
					</div>

					{#if job.lastError}
						<p class="mt-3 text-[13px] break-words text-danger-700">{job.lastError}</p>
					{/if}
				</Card>
			{/each}
		</div>
	{/if}

	<p class="mt-4 px-1 text-[13px] text-muted">
		Джоб попадает сюда, когда кончились попытки. Перезапуск из панели не предусмотрен — почините
		причину и поставьте работу заново.
	</p>

	<h2 class="mt-8 px-1 text-[12px] font-semibold tracking-[.06em] text-muted uppercase">
		Сверка с Marzban
	</h2>

	{#if reconcileAnswer?.message}
		<p class={['mt-3 px-1 text-[14px]', tone(reconcileAnswer.ok)]}>{reconcileAnswer.message}</p>
	{/if}

	<div class="mt-3">
		<Card>
			<ReconcileForm
				errors={reconcileAnswer?.errors ?? {}}
				values={reconcileAnswer?.values ?? {}}
			/>
		</Card>
	</div>

	<p class="mt-4 px-1 text-[13px] text-muted">
		Сверка приводит панель к тому, что записано у нас: дату окончания и доступ. Наша запись ведущая,
		из Marzban ничего не читается обратно. Повторный запуск в течение часа ничего не добавит.
	</p>
</div>

<Modal
	bind:open={confirmOpen}
	title="В архив?"
	confirmLabel="В архив"
	cancelLabel="Отмена"
	onconfirm={() => archiving?.form.requestSubmit()}
>
	<p class="text-[14px] text-muted">{archiving?.body}</p>
</Modal>
