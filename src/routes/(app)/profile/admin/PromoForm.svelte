<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Button from '$lib/ui/Button.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Money from '$lib/ui/Money.svelte';
	import type { Currency } from '$lib/types';

	/**
	 * The row this form edits, described structurally rather than by name.
	 *
	 * `PromoAdminView` lives in `$lib/server/billing` (see promo-view.ts for why it exists at all),
	 * and a component may not import from there — Vite breaks the build on purpose. The shape below is
	 * what the load actually hands down, so a change to the view still fails this file's typecheck.
	 */
	interface EditablePromo {
		id: number;
		code: string;
		discountType: 'percent' | 'fixed';
		discountValue: number;
		maxUses: number | null;
		validFrom: number | null;
		validUntil: number | null;
		isActive: boolean;
	}

	interface Props {
		/** '?/createPromo' or '?/updatePromo'. The action itself decides what the fields mean. */
		action: string;
		/** The row being edited, or null for the create form. */
		promo?: EditablePromo | null;
		/** Currency of the base, shown under a fixed discount so nobody types dollars into cents. */
		currency: Currency;
		/** Field name -> message from the last rejected submit of THIS form. */
		errors?: Record<string, string>;
		/** What was typed in that submit, so a no-JS reload comes back filled instead of blank. */
		values?: Record<string, string>;
		submitLabel: string;
	}

	let { action, promo = null, currency, errors = {}, values = {}, submitLabel }: Props = $props();

	interface Fields {
		code: string;
		discountType: 'percent' | 'fixed';
		discountValue: string;
		maxUses: string;
		validFrom: string;
		validUntil: string;
		isActive: boolean;
	}

	/**
	 * `<input type="date">` speaks YYYY-MM-DD, and the column holds a moment. Read back in UTC, which
	 * is the timezone the parser writes them in — reading them locally would show an admin west of
	 * Greenwich the day before the one they typed.
	 */
	const dateValue = (ms: number | null) =>
		ms === null ? '' : new Date(ms).toISOString().slice(0, 10);

	/**
	 * Seeded from the echo when there is one, from the row otherwise. With JS the DOM already holds
	 * what was typed; without it the page reloads and `values` is the only surviving record of the
	 * attempt. An unchecked box submits nothing at all, so the echo is recognised as a whole rather
	 * than field by field.
	 */
	function seed(useEcho = true): Fields {
		const echoed = useEcho && Object.keys(values).length > 0;
		const field = (key: string, fallback: string) => (echoed ? (values[key] ?? '') : fallback);

		return {
			code: field('code', promo?.code ?? ''),
			discountType:
				(echoed ? values.discountType : promo?.discountType) === 'fixed' ? 'fixed' : 'percent',
			discountValue: field('discountValue', promo ? String(promo.discountValue) : ''),
			maxUses: field('maxUses', promo?.maxUses != null ? String(promo.maxUses) : ''),
			validFrom: field('validFrom', dateValue(promo?.validFrom ?? null)),
			validUntil: field('validUntil', dateValue(promo?.validUntil ?? null)),
			isActive: echoed ? values.isActive === 'on' : (promo?.isActive ?? true)
		};
	}

	// Read once, on purpose: after mount these inputs belong to the person typing in them, and a prop
	// change must not overwrite an edit in progress.
	let fields = $state(untrack(() => seed()));

	let saving = $state(false);

	// Every promo row renders one of these forms, so the ids have to be unique per instance.
	const formId = $props.id();

	/**
	 * A message stands only while the input still holds exactly what the server rejected. Editing the
	 * field retires it — an error that survives the fix tells the admin their correction did not take.
	 */
	type TextField = Exclude<keyof Fields, 'isActive' | 'discountType'>;
	const errorFor = (key: TextField) =>
		errors[key] && fields[key] === (values[key] ?? '') ? errors[key] : undefined;

	// Only digits are a discount yet, so anything else previews nothing.
	let fixedPreview = $derived(
		fields.discountType === 'fixed' && /^\d+$/.test(fields.discountValue.trim())
			? Number(fields.discountValue)
			: null
	);

	/**
	 * CONTRACT GAP, held open deliberately: `lib/ui` (tech.md 12, lead-owned) has no Select primitive
	 * and `Input.svelte` accepts no `type="date"`. This form needs both — a discount is one of two
	 * kinds, and a validity window is two dates. The two controls below are local stubs wearing the
	 * same tokens as the primitives, and they are meant to be deleted the day those land.
	 */
	const CONTROL =
		'h-12 w-full min-w-0 rounded-field bg-surface px-4 text-sm text-ink appearance-none';
	const LABEL = 'mb-1.5 block px-1 text-xs font-medium text-muted';
</script>

{#snippet dateField(name: 'validFrom' | 'validUntil', label: string)}
	{@const id = `${formId}-${name}`}
	{@const errorId = `${id}-error`}
	{@const error = errorFor(name)}

	<div>
		<label for={id} class={LABEL}>{label}</label>
		<!--
			`name` is the field key, not a loose string: a typo would otherwise compile, write into a
			property nobody reads, and submit an empty date — which parses to "no end date" and quietly
			sells a campaign that never expires.
		-->
		<input
			{id}
			{name}
			type="date"
			value={fields[name]}
			oninput={(event) => (fields[name] = event.currentTarget.value)}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? errorId : undefined}
			class={CONTROL}
		/>
		{#if error}
			<p id={errorId} class="mt-2 px-1 text-xs text-danger-700">{error}</p>
		{/if}
	</div>
{/snippet}

<form
	method="POST"
	{action}
	class="space-y-3"
	use:enhance={() => {
		saving = true;

		return async ({ result, update }) => {
			// The inputs are controlled by `fields`, so a native reset would leave them untouched.
			// Clearing is only right for the create form: an edit that saved should keep showing what it
			// saved, and a rejected submit of either kind must keep what was typed. Seeded without the
			// echo, or the rejected attempt would come back instead of a blank form.
			if (result.type === 'success' && !promo) fields = seed(false);

			await update({ reset: false });
			saving = false;
		};
	}}
>
	{#if promo}
		<input type="hidden" name="id" value={promo.id} />
	{/if}

	<Input
		bind:value={fields.code}
		name="code"
		label="Код"
		maxlength={32}
		uppercase
		required
		error={errorFor('code')}
		placeholder="START30"
	/>

	<div class="grid grid-cols-2 gap-3">
		<div>
			<label for="{formId}-type" class={LABEL}>Тип скидки</label>
			<select
				id="{formId}-type"
				name="discountType"
				bind:value={fields.discountType}
				class={CONTROL}
			>
				<option value="percent">Процент</option>
				<option value="fixed">Фиксированная</option>
			</select>
		</div>

		<div>
			<Input
				bind:value={fields.discountValue}
				name="discountValue"
				label={fields.discountType === 'percent' ? 'Скидка, %' : 'Скидка, мин. единицы'}
				inputmode="numeric"
				required
				error={errorFor('discountValue')}
			/>
			{#if fixedPreview !== null && !errorFor('discountValue')}
				<!-- Minor units are what the column holds; this line is what the customer will save. -->
				<p class="mt-2 px-1 text-xs text-muted">
					= <Money minor={fixedPreview} {currency} />
				</p>
			{/if}
		</div>

		{@render dateField('validFrom', 'Начало')}
		{@render dateField('validUntil', 'Окончание')}
	</div>

	<Input
		bind:value={fields.maxUses}
		name="maxUses"
		label="Лимит применений"
		inputmode="numeric"
		error={errorFor('maxUses')}
		placeholder="Без ограничения"
	/>

	<label class="flex items-center gap-2.5 px-1 text-sm">
		<input
			type="checkbox"
			name="isActive"
			bind:checked={fields.isActive}
			class="size-5 accent-accent-600"
		/>
		Промокод работает
	</label>

	<Button type="submit" size="sm" class="w-full" loading={saving}>{submitLabel}</Button>
</form>
