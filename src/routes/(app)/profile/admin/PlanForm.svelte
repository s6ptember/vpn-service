<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Money from '$lib/ui/Money.svelte';
	import type { Currency, PlanDTO } from '$lib/types';
	import { gibFromBytes } from '../../plan-value';

	interface Props {
		/** '?/create' or '?/update'. The action itself decides what the fields mean. */
		action: string;
		/** The row being edited, or null for the create form. */
		plan?: PlanDTO | null;
		/** Currency of the base, shown under the price so nobody types dollars into a minor-unit field. */
		currency: Currency;
		/** Field name -> message from the last rejected submit of THIS form. */
		errors?: Record<string, string>;
		/** What was typed in that submit, so a no-JS reload comes back filled instead of blank. */
		values?: Record<string, string>;
		submitLabel: string;
	}

	let { action, plan = null, currency, errors = {}, values = {}, submitLabel }: Props = $props();

	interface Fields {
		name: string;
		description: string;
		durationDays: string;
		priceMinor: string;
		trafficLimitGib: string;
		sortOrder: string;
		isActive: boolean;
	}

	/**
	 * Seeded from the echo when there is one, from the plan otherwise. With JS the DOM already holds
	 * what was typed and the echo is redundant; without it the page reloads, this component mounts
	 * afresh, and `values` is the only surviving record of the attempt. An unchecked box submits
	 * nothing at all, so the echo has to be recognised as a whole rather than field by field.
	 */
	function seed(useEcho = true): Fields {
		const echoed = useEcho && Object.keys(values).length > 0;
		// The echo is consulted only when it is being used at all: `values` still holds the last
		// rejected attempt when the form is blanked after a save, so reading it either way would
		// bring that attempt straight back.
		const field = (key: string, fallback: string) => (echoed ? (values[key] ?? '') : fallback);

		return {
			name: field('name', plan?.name ?? ''),
			description: field('description', plan?.description ?? ''),
			durationDays: field('durationDays', plan ? String(plan.durationDays) : '30'),
			priceMinor: field('priceMinor', plan ? String(plan.priceMinor) : ''),
			trafficLimitGib: field(
				'trafficLimitGib',
				plan ? String(gibFromBytes(plan.trafficLimitBytes)) : '0'
			),
			sortOrder: field('sortOrder', plan ? String(plan.sortOrder) : '0'),
			isActive: echoed ? values.isActive === 'on' : (plan?.isActive ?? true)
		};
	}

	// Read once, on purpose: after mount these inputs belong to the person typing in them, and a
	// prop change must not overwrite an edit in progress.
	let fields = $state(untrack(() => seed()));

	let saving = $state(false);

	/**
	 * A message stands only while the input still holds exactly what the server rejected. Editing
	 * the field retires it — an error that survives the fix tells the admin their correction did not
	 * take, and it needs no extra state to notice: the echo is the submitted value.
	 */
	type TextField = Exclude<keyof Fields, 'isActive'>;
	const errorFor = (key: TextField) =>
		errors[key] && fields[key] === (values[key] ?? '') ? errors[key] : undefined;

	// Only digits reach the schema, so anything else is not a price yet and previews nothing.
	let pricePreview = $derived(
		/^\d+$/.test(fields.priceMinor.trim()) ? Number(fields.priceMinor) : null
	);
</script>

<form
	method="POST"
	{action}
	class="space-y-3"
	use:enhance={() => {
		saving = true;

		return async ({ result, update }) => {
			// The inputs are controlled by `fields`, so a native form reset would leave them untouched.
			// Clearing is only right for the create form anyway: an edit that saved should keep showing
			// what it saved, and a rejected submit of either kind must keep what was typed.
			// Seeded without the echo, or a previously rejected attempt would come back instead of a
			// blank form — `values` still holds it until `update()` swaps the props.
			if (result.type === 'success' && !plan) fields = seed(false);

			await update({ reset: false });
			saving = false;
		};
	}}
>
	{#if plan}
		<input type="hidden" name="id" value={plan.id} />
	{/if}

	<Input
		bind:value={fields.name}
		name="name"
		label="Название"
		maxlength={64}
		required
		error={errorFor('name')}
		placeholder="30 дней"
	/>

	<Input
		bind:value={fields.description}
		name="description"
		label="Подпись на карточке"
		maxlength={200}
		error={errorFor('description')}
		placeholder="Обычный выбор"
	/>

	<div class="grid grid-cols-2 gap-3">
		<Input
			bind:value={fields.durationDays}
			name="durationDays"
			label="Срок, дней"
			inputmode="numeric"
			required
			error={errorFor('durationDays')}
		/>

		<Input
			bind:value={fields.trafficLimitGib}
			name="trafficLimitGib"
			label="Трафик, ГБ"
			inputmode="numeric"
			required
			error={errorFor('trafficLimitGib')}
		/>

		<div>
			<Input
				bind:value={fields.priceMinor}
				name="priceMinor"
				label="Цена, минорные единицы"
				inputmode="numeric"
				required
				error={errorFor('priceMinor')}
			/>
			{#if pricePreview !== null && !errorFor('priceMinor')}
				<!-- Minor units are what the column holds; this line is what the customer will read. -->
				<p class="mt-2 px-1 text-xs text-muted">
					= <Money minor={pricePreview} {currency} />
				</p>
			{/if}
		</div>

		<Input
			bind:value={fields.sortOrder}
			name="sortOrder"
			label="Порядок"
			inputmode="numeric"
			required
			error={errorFor('sortOrder')}
		/>
	</div>

	<label class="flex items-center gap-2.5 px-1 text-sm">
		<input
			type="checkbox"
			name="isActive"
			bind:checked={fields.isActive}
			class="size-5 accent-accent"
		/>
		Показывать на главной
	</label>

	<Button type="submit" size="sm" class="w-full" loading={saving}>{submitLabel}</Button>
</form>
