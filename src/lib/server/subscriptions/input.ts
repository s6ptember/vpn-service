import * as v from 'valibot';
import type { Result } from '$lib/types';

/**
 * The subscriptions domain owns its own input contract: the reconcile form under /profile/admin
 * hands raw FormData here and receives either a parsed input or field-level messages (CLAUDE.md 2 —
 * unparsed data never reaches the domain).
 *
 * ## Why the form takes a Telegram id and not a subscription id
 *
 * tech.md 6 keys `marzban.reconcile` by `subscriptionId`, and nothing in the panel tech.md 11
 * describes ever shows one: there is no subscriptions list, and the id is an internal
 * autoincrement the admin has no way to learn. The Telegram id, by contrast, is in front of them
 * already — every relayed support request prints `@username` or `ID <telegramId>`
 * (jobs/handlers/support-notify-admin.ts).
 *
 * So the screen asks for the id a human actually holds and the action resolves it to the id the
 * contract wants. The queue key stays exactly `reconcile:<subscriptionId>:<hour>`.
 */

/**
 * Every field starts optional and falls back to '', so a key the form did not send fails our own
 * rule instead of valibot's — the default message would otherwise reach the admin in English,
 * quoting a schema they cannot see. Same construction as plans/input.ts.
 */
const textField = (message: string) => v.optional(v.string(message), '');

/** Telegram ids are positive and comfortably inside the safe integer range. */
const MAX_TELEGRAM_ID = Number.MAX_SAFE_INTEGER;

const ReconcileSchema = v.object({
	telegramId: v.pipe(
		textField('Telegram ID: введите число'),
		v.trim(),
		v.regex(/^\d+$/, 'Telegram ID: введите число'),
		// Length first: 400 digits pass the regex and come out of Number() as Infinity, which fails
		// v.integer() before either bound is reached. Rejecting on length keeps that impossible.
		v.maxLength(String(MAX_TELEGRAM_ID).length, 'Telegram ID: слишком длинный'),
		v.transform(Number),
		v.integer('Telegram ID: введите число'),
		v.minValue(1, 'Telegram ID: введите число больше нуля'),
		v.maxValue(MAX_TELEGRAM_ID, 'Telegram ID: слишком большой')
	)
});

export type ReconcileInput = v.InferOutput<typeof ReconcileSchema>;

/** Field name -> first message for that field, so the form shows one line per input. */
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

/** Pure input logic: no DB, no clock, no HTTP. */
export class ReconcileInputParser {
	parse(raw: unknown): Result<ReconcileInput, Record<string, string>> {
		const result = v.safeParse(ReconcileSchema, raw);

		return result.success
			? { ok: true, value: result.output }
			: { ok: false, error: fieldErrors(result.issues) };
	}
}
