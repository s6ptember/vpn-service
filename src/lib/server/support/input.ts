import * as v from 'valibot';
import { TICKET_MESSAGE_MAX, TICKET_MESSAGE_MIN, type Result } from '$lib/types';

/**
 * The support domain owns its own input contract: the action hands raw FormData here and gets back
 * either a parsed message or one sentence to show under the field (CLAUDE.md 2 — unparsed data
 * never reaches the domain).
 *
 * The bounds are the frozen ones from `$lib/types` (10..2000, the same numbers the column comments
 * carry), so the textarea's counter, this schema and the table can never drift apart.
 */

/**
 * The field starts optional and falls back to '', so a key the form did not send fails our own rule
 * instead of valibot's — the default message would otherwise reach somebody in English, quoting a
 * schema they cannot see.
 */
const TOO_SHORT = `Расскажите чуть подробнее — не меньше ${TICKET_MESSAGE_MIN} символов.`;
const TOO_LONG = `Слишком длинно. Уложитесь в ${TICKET_MESSAGE_MAX} символов.`;

const TicketSchema = v.object({
	message: v.pipe(
		v.optional(v.string(TOO_SHORT), ''),
		/**
		 * Trimmed before it is measured and before it is stored. Otherwise a screenful of newlines
		 * passes the minimum and lands in the admin's Telegram as an empty message, and the same
		 * whitespace counts against the maximum for somebody with a real problem to describe.
		 */
		v.trim(),
		v.minLength(TICKET_MESSAGE_MIN, TOO_SHORT),
		v.maxLength(TICKET_MESSAGE_MAX, TOO_LONG)
	)
});

export type TicketInput = v.InferOutput<typeof TicketSchema>;

/** Pure input logic: no DB, no clock, no HTTP. */
export class TicketInputParser {
	parse(raw: unknown): Result<TicketInput, string> {
		const result = v.safeParse(TicketSchema, raw);

		// One field, so one message: the first failing rule is the one there is anything to do about.
		return result.success
			? { ok: true, value: result.output }
			: { ok: false, error: result.issues[0].message };
	}
}
