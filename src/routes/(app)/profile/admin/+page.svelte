<script lang="ts">
	import { ChevronDown, Plus } from 'lucide-svelte';
	import { enhance } from '$app/forms';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Card from '$lib/ui/Card.svelte';
	import EmptyState from '$lib/ui/EmptyState.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Money from '$lib/ui/Money.svelte';
	import type { PlanDTO } from '$lib/types';
	import { formatDays, formatTraffic } from '../../plan-value';
	import PlanForm from './PlanForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let creating = $state(false);
	/** The plan the confirmation is about. Kept after the dialog closes: only confirm submits. */
	let archiving = $state<PlanDTO | null>(null);
	let confirmOpen = $state(false);
	let archiveForm = $state<HTMLFormElement | null>(null);

	/** An answer belongs to exactly one form; every other block stays quiet. */
	const answerFor = (target: number | null) => (form?.target === target ? form : null);

	let listed = $derived(new Set(data.plans.map((plan) => plan.id)));

	/**
	 * Whether the block that owns the answer is on screen to show it. Archiving is the case that
	 * needs this: the plan it reports on is gone from the list by the time the answer arrives, so
	 * without a page-level line the admin would click "В архив" and see nothing happen at all.
	 */
	let answerHasHome = $derived(
		form === null || form === undefined
			? true
			: form.target === null
				? creating
				: listed.has(form.target)
	);

	let banner = $derived(answerHasHome ? null : (form?.message ?? null));

	function askArchive(plan: PlanDTO) {
		archiving = plan;
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
		{@const answer = answerFor(null)}

		<div class="mt-3">
			<Card>
				{#if answer?.message}
					<p class="mb-3 text-[14px] text-danger-700">{answer.message}</p>
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
				{@const answer = answerFor(plan.id)}

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
						<p class="mt-3 text-[14px] text-muted">{answer.message}</p>
					{/if}

					<details class="mt-3 border-t border-line pt-3">
						<summary
							class="flex cursor-pointer list-none items-center justify-between text-[15px] font-medium press"
						>
							Изменить
							<ChevronDown class="size-4 text-muted" aria-hidden="true" />
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

							<Button
								variant="danger"
								size="sm"
								class="mt-3 w-full"
								onclick={() => askArchive(plan)}
								aria-label="Отправить тариф {plan.name} в архив"
							>
								В архив
							</Button>
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
</div>

<!--
	The confirmation is collected by the dialog but sent by a real form, so the write keeps the CSRF
	check and the no-JS path that every other action on this page has.
-->
<form method="POST" action="?/archive" bind:this={archiveForm} use:enhance class="hidden">
	<input type="hidden" name="id" value={archiving?.id ?? ''} />
</form>

<Modal
	bind:open={confirmOpen}
	title="В архив?"
	confirmLabel="В архив"
	cancelLabel="Отмена"
	onconfirm={() => archiveForm?.requestSubmit()}
>
	<p class="text-[14px] text-muted">
		«{archiving?.name}» пропадёт с главной и из этого списка. Прошлые заказы останутся, вернуть
		тариф обратно нельзя.
	</p>
</Modal>
