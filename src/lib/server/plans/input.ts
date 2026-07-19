import * as v from 'valibot';
import { MIN_CHARGE_MINOR, type Currency, type Result } from '$lib/types';

/**
 * The plans domain owns its own input contract: every action under /profile/admin hands raw
 * FormData here and receives either a parsed input or field-level messages (CLAUDE.md 2 — unparsed
 * data never reaches the domain).
 *
 * Errors are keyed by field name so the form can put each message under the input that caused it.
 */

/**
 * The admin types gigabytes; the column stores bytes. The inverse lives in routes/(app)/plan-value.ts
 * because `$lib/server` cannot be imported from a component, and the frozen folder layout (tech.md 4)
 * offers no shared non-server module a developer may add to.
 */
const BYTES_PER_GIB = 1024 ** 3;

/** Ten years. Nothing rejects a longer plan on principle — this catches a typed extra digit. */
const MAX_DURATION_DAYS = 3650;
/** 1 000 000 minor units, ~10 000 in a two-decimal currency. Same purpose: catch a slipped zero. */
const MAX_PRICE_MINOR = 1_000_000;
const MAX_TRAFFIC_GIB = 100_000;
const MAX_SORT_ORDER = 9999;

/**
 * Every field starts optional and falls back to '', so a key the form did not send fails our own
 * rule instead of valibot's. The default message would otherwise reach the admin in English,
 * quoting a schema they cannot see.
 */
const textField = (message: string) => v.optional(v.string(message), '');

const integerField = (label: string, min: number, max: number) =>
	v.pipe(
		textField(`${label}: введите целое число`),
		v.trim(),
		v.regex(/^\d+$/, `${label}: введите целое число`),
		// Length first: 400 digits pass the regex and come out of Number() as Infinity, which fails
		// v.integer() before either bound is reached. Rejecting on length keeps that impossible.
		v.maxLength(String(max).length, `${label}: не больше ${max}`),
		v.transform(Number),
		v.integer(`${label}: введите целое число`),
		v.minValue(min, `${label}: не меньше ${min}`),
		v.maxValue(max, `${label}: не больше ${max}`)
	);

function planInputSchema(currency: Currency) {
	const fields = v.object({
		name: v.pipe(
			textField('Название: заполните поле'),
			v.trim(),
			v.minLength(1, 'Название: заполните поле'),
			v.maxLength(64, 'Название: не длиннее 64 символов')
		),
		// An empty field means "no description", and the column is nullable — '' would be a third state.
		description: v.pipe(
			textField('Описание: не поняли значение'),
			v.trim(),
			v.maxLength(200, 'Описание: не длиннее 200 символов'),
			v.transform((text): string | null => text || null)
		),
		durationDays: integerField('Срок', 1, MAX_DURATION_DAYS),
		// tech.md 5: a plan may not be priced under what Stripe will actually charge.
		priceMinor: integerField('Цена', MIN_CHARGE_MINOR[currency], MAX_PRICE_MINOR),
		// Named for the unit the admin types. The transform below is the only place gigabytes become
		// bytes, and an issue on this field still points at the input that produced it.
		trafficLimitGib: integerField('Трафик', 0, MAX_TRAFFIC_GIB),
		sortOrder: integerField('Порядок', 0, MAX_SORT_ORDER),
		// An unchecked checkbox sends nothing at all, which is how HTML says false.
		isActive: v.pipe(
			textField('Показ на главной: не поняли значение'),
			v.transform((value) => value === 'on')
		)
	});

	return v.pipe(
		fields,
		v.transform(({ trafficLimitGib, ...rest }) => ({
			...rest,
			trafficLimitBytes: trafficLimitGib * BYTES_PER_GIB
		}))
	);
}

export type PlanInput = v.InferOutput<ReturnType<typeof planInputSchema>>;

/** Identifies the plan an admin action targets. Ids come from our own markup, so this only has to
 *  survive a stale page, not an attack — the isAdmin check in the action is what guards the write. */
const PlanIdSchema = v.object({
	id: v.pipe(
		textField(''),
		v.trim(),
		v.regex(/^\d+$/),
		v.transform(Number),
		v.integer(),
		v.minValue(1)
	)
});

/** One sentence for every way an id can be wrong: there is nothing for the admin to fix here, and
 *  a schema message would only quote a form they never filled in. */
const BAD_ID_MESSAGE = 'Не поняли, какой тариф изменить.';

/** Field name -> first message for that field. Later issues on the same field are noise: the form
 *  shows one line per input, and the first failing rule is the one the admin has to fix. */
function fieldErrors(
	issues: [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]]
): Record<string, string> {
	const errors: Record<string, string> = {};

	for (const issue of issues) {
		const field = issue.path?.map((segment) => String(segment.key)).join('.') ?? '';
		if (field && !(field in errors)) errors[field] = issue.message;
	}

	return errors;
}

/**
 * Pure input logic: no DB, no clock, no HTTP. Currency arrives by constructor because the minimum
 * charge depends on it and the domain must not read config itself (CLAUDE.md 3).
 */
export class PlanInputParser {
	private readonly schema: ReturnType<typeof planInputSchema>;

	constructor(currency: Currency) {
		this.schema = planInputSchema(currency);
	}

	parse(raw: unknown): Result<PlanInput, Record<string, string>> {
		const result = v.safeParse(this.schema, raw);

		return result.success
			? { ok: true, value: result.output }
			: { ok: false, error: fieldErrors(result.issues) };
	}

	parseId(raw: unknown): Result<number, string> {
		const result = v.safeParse(PlanIdSchema, raw);

		return result.success
			? { ok: true, value: result.output.id }
			: { ok: false, error: BAD_ID_MESSAGE };
	}
}
