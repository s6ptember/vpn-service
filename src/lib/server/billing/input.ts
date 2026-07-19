import * as v from 'valibot';
import type { Result } from '$lib/types';

/**
 * The input surface of the billing routes: the purchase form, the profile's promo check, and the
 * admin's promo forms. Nothing reaches the domain without passing through here (CLAUDE.md 2).
 */

/** Long enough for any campaign name, short enough that the column never sees a paragraph. */
const MAX_CODE_LENGTH = 32;

const BAD_PLAN_MESSAGE = 'Не поняли, какой тариф вы выбрали.';
/** One sentence for every way a code can be malformed: it is the same fix in each case — retype it. */
const BAD_CODE_MESSAGE = 'Промокод состоит из латинских букв, цифр и дефисов.';

/**
 * What a promo code is allowed to look like, in one place.
 *
 * The two schemas below differ only in whether an empty field is an answer. Everything a code IS —
 * the alphabet, the length, and the upper-casing tech.md 5 stores it in — is these three constants,
 * because `promo_codes.code` is UPPERCASE in the column and SQLite compares text byte for byte: a
 * code minted lowercase by the admin form would be unreachable from the customer's field, which
 * upper-cases. Both ends spell it the same way or the feature quietly does not work.
 */
const CODE_PATTERN = /^[A-Z0-9-]+$/;

/** The purchase form, where a blank field means "no code" and comes out as undefined, never ''. */
export const optionalPromoCode = v.pipe(
	v.optional(v.string(BAD_CODE_MESSAGE), ''),
	v.trim(),
	v.toUpperCase(),
	v.maxLength(MAX_CODE_LENGTH, BAD_CODE_MESSAGE),
	// A blank field is not an attempt, so it is not held to the alphabet.
	v.check((code) => code === '' || CODE_PATTERN.test(code), BAD_CODE_MESSAGE),
	v.transform((code): string | undefined => code || undefined)
);

/** The profile check and the admin form, where a blank field is a mistake worth a sentence. */
const requiredPromoCode = (emptyMessage: string) =>
	v.pipe(
		v.optional(v.string(emptyMessage), ''),
		v.trim(),
		v.toUpperCase(),
		v.minLength(1, emptyMessage),
		v.maxLength(MAX_CODE_LENGTH, BAD_CODE_MESSAGE),
		v.regex(CODE_PATTERN, BAD_CODE_MESSAGE)
	);

/**
 * The whole input surface of `?/createCheckout`: a plan id, and optionally a promo code (tech.md 10,
 * step 1).
 *
 * That it is this small is the security property. The price, the currency and the discount are
 * computed on the server — from the plan the id names and the promo row the code names — so there is
 * no field here for a form to lie about money with. A code is a name, not an amount: what it is
 * worth is read from the database and never from this object (CLAUDE.md 2).
 */
const CheckoutSchema = v.object({
	planId: v.pipe(
		// The message is ours even for the type check: FormData yields strings, but a File would
		// land here as an object, and valibot's own English sentence is written for a schema author
		// rather than for the person reading it.
		v.optional(v.string(BAD_PLAN_MESSAGE), ''),
		v.trim(),
		v.regex(/^\d+$/, BAD_PLAN_MESSAGE),
		// 16 digits cannot be a row id; without the cap a long numeric string reaches Number() and
		// comes back as Infinity, which fails v.integer() with a message written for a schema.
		v.maxLength(16, BAD_PLAN_MESSAGE),
		v.transform(Number),
		v.integer(BAD_PLAN_MESSAGE),
		v.minValue(1, BAD_PLAN_MESSAGE)
	),
	promoCode: optionalPromoCode
});

export type CheckoutInput = v.InferOutput<typeof CheckoutSchema>;

/** Pure input logic: no DB, no clock, no HTTP. */
export class CheckoutInputParser {
	parse(raw: unknown): Result<CheckoutInput, string> {
		const result = v.safeParse(CheckoutSchema, raw);

		return result.success
			? { ok: true, value: result.output }
			: { ok: false, error: result.issues[0].message };
	}
}

/**
 * The profile's promo check (A10). One field, and it must actually hold something: an empty submit
 * there is a slip worth a sentence rather than a silent no-op.
 */
const PromoCheckSchema = v.object({ promoCode: requiredPromoCode('Введите промокод.') });

export class PromoCheckInputParser {
	parse(raw: unknown): Result<string, string> {
		const result = v.safeParse(PromoCheckSchema, raw);

		return result.success
			? { ok: true, value: result.output.promoCode }
			: { ok: false, error: result.issues[0].message };
	}
}

/* ------------------------------------------------------------------ admin */

/** 1 000 000 minor units, ~10 000 in a two-decimal currency: catches a slipped zero, nothing more. */
const MAX_FIXED_DISCOUNT_MINOR = 1_000_000;
const MAX_USES = 1_000_000;

const BAD_ID_MESSAGE = 'Не поняли, какой промокод изменить.';

const textField = (message: string) => v.optional(v.string(message), '');

/**
 * `<input type="date">` submits `YYYY-MM-DD` and nothing else, so the window is read in UTC: the
 * container's timezone must not decide when a campaign starts. `validFrom` opens at the first
 * millisecond of the day typed and `validUntil` closes at the last — an admin who types the 31st
 * means the code works all of the 31st, and PromoValidator compares against the moment, not the day.
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dateField = (label: string, endOfDay: boolean) =>
	v.pipe(
		textField(`${label}: введите дату`),
		v.trim(),
		v.check((text) => text === '' || DATE_PATTERN.test(text), `${label}: введите дату`),
		v.transform((text): Date | null => {
			if (!text) return null;
			return new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
		}),
		v.check(
			(date) => date === null || Number.isFinite(date.getTime()),
			`${label}: такой даты не существует`
		)
	);

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

const PromoSchema = v.pipe(
	v.object({
		code: requiredPromoCode('Код: заполните поле'),
		discountType: v.picklist(['percent', 'fixed'], 'Тип скидки: выберите значение'),
		// Bounded by the looser of the two types; the cross-field check below narrows it for percent,
		// where it can point at the field the admin has to fix.
		discountValue: integerField('Размер скидки', 1, MAX_FIXED_DISCOUNT_MINOR),
		// An empty field is "unlimited" — the column is nullable (tech.md 5), and 0 would instead mean
		// a code that is exhausted the moment it is created.
		maxUses: v.pipe(
			textField('Лимит: введите целое число'),
			v.trim(),
			v.check((text) => text === '' || /^\d+$/.test(text), 'Лимит: введите целое число'),
			// Length before Number(): a 400-digit string parses to Infinity and would slip past a
			// numeric bound with a message written for a schema rather than for the admin.
			v.maxLength(String(MAX_USES).length, `Лимит: не больше ${MAX_USES}`),
			v.transform((text): number | null => (text === '' ? null : Number(text))),
			v.check(
				(value) => value === null || (value >= 1 && value <= MAX_USES),
				`Лимит: от 1 до ${MAX_USES}`
			)
		),
		validFrom: dateField('Начало', false),
		validUntil: dateField('Окончание', true),
		// An unchecked checkbox sends nothing at all, which is how HTML says false.
		isActive: v.pipe(
			textField('Включён: не поняли значение'),
			v.transform((value) => value === 'on')
		)
	}),
	// tech.md 5: percent is 1..100. Forwarded so the message lands under the input that carries it.
	v.forward(
		v.check(
			(input) => input.discountType !== 'percent' || input.discountValue <= 100,
			'Размер скидки: для процентов не больше 100'
		),
		['discountValue']
	),
	v.forward(
		v.check(
			(input) =>
				input.validFrom === null ||
				input.validUntil === null ||
				input.validFrom.getTime() <= input.validUntil.getTime(),
			'Окончание: не раньше начала'
		),
		['validUntil']
	)
);

export type PromoInput = v.InferOutput<typeof PromoSchema>;

const PromoIdSchema = v.object({
	id: v.pipe(
		textField(''),
		v.trim(),
		v.regex(/^\d+$/),
		v.transform(Number),
		v.integer(),
		v.minValue(1)
	)
});

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

/** Pure input logic: no DB, no clock, no HTTP. Mirrors PlanInputParser, deliberately. */
export class PromoInputParser {
	parse(raw: unknown): Result<PromoInput, Record<string, string>> {
		const result = v.safeParse(PromoSchema, raw);

		return result.success
			? { ok: true, value: result.output }
			: { ok: false, error: fieldErrors(result.issues) };
	}

	parseId(raw: unknown): Result<number, string> {
		const result = v.safeParse(PromoIdSchema, raw);

		return result.success
			? { ok: true, value: result.output.id }
			: { ok: false, error: BAD_ID_MESSAGE };
	}
}
