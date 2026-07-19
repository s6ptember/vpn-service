import * as v from 'valibot';
import type { Result } from '$lib/types';

/**
 * The whole input surface of `?/createCheckout`: one plan id.
 *
 * That it is this small is the security property, not an accident. The price, the currency and the
 * discount are computed on the server from the plan the id names (tech.md 10, step 2), so there is
 * no field here for a form to lie about — an amount posted alongside is not "ignored later", it is
 * dropped by the schema before the domain ever sees it (CLAUDE.md 2).
 */
const CheckoutSchema = v.object({
	planId: v.pipe(
		v.optional(v.string(), ''),
		v.trim(),
		v.regex(/^\d+$/, 'Не поняли, какой тариф вы выбрали.'),
		// 16 digits cannot be a row id; without the cap a long numeric string reaches Number() and
		// comes back as Infinity, which fails v.integer() with a message written for a schema.
		v.maxLength(16, 'Не поняли, какой тариф вы выбрали.'),
		v.transform(Number),
		v.integer('Не поняли, какой тариф вы выбрали.'),
		v.minValue(1, 'Не поняли, какой тариф вы выбрали.')
	)
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
