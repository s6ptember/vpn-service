import { fail } from '@sveltejs/kit';
import { faq, ticketInput, tickets } from '$lib/server/container';
import { log } from '$lib/server/log';
import type { Actions, PageServerLoad } from './$types';

/**
 * A13 — the FAQ accordion, read from `faq_items` (tech.md 11).
 *
 * Nothing here is personal, so this load never looks at `locals.user`: the questions are the same
 * for everybody and they render on the very first pass, before the cookie lands (tech.md 9). That
 * is the whole point of putting them on the section somebody opens when something is already
 * broken — an answer that waits for a handshake is an answer that arrives too late.
 */
export const load: PageServerLoad = async () => {
	return { faq: faq.listActive() };
};

/** What the form gets back. A refusal carries the sentence and the text, so nothing typed is lost. */
interface TicketResult {
	ok: boolean;
	message: string | null;
	/** Echoed exactly as typed, so a no-JS reload comes back filled instead of blank. */
	text: string;
}

const refuse = (status: number, message: string, text: string) =>
	fail(status, { ok: false, message, text } satisfies TicketResult);

/** What a spent budget says. CLAUDE.md 2 caps support at three requests an hour per person. */
const rateLimitMessage = (retryAfterSec: number) =>
	`Вы уже отправили три обращения за час. Напишите снова через ${Math.ceil(retryAfterSec / 60)} мин — или дождитесь ответа на предыдущее.`;

export const actions = {
	/**
	 * A14 — writes the request and hands it to the queue, which relays it to the admin's Telegram.
	 *
	 * The relay itself is deliberately not awaited here: Bot API can be slow or down, and somebody
	 * describing a problem must not watch a spinner for it. tech.md 6 makes that a job, and the
	 * ticket row is the promise that it will happen even if the process dies on the next line.
	 */
	createTicket: async ({ request, locals }) => {
		/**
		 * The guard in hooks.server.ts already 401s a POST without a session. This is the second check
		 * tech.md 9 asks for rather than a copy of the first: a ticket belongs to a person, and that
		 * person comes off the session and never off the form.
		 */
		if (!locals.user) {
			return refuse(401, 'Откройте приложение из Telegram, чтобы написать нам.', '');
		}

		const values = Object.fromEntries(await request.formData());
		const typed = typeof values.message === 'string' ? values.message : '';

		const parsed = ticketInput.parse(values);
		if (!parsed.ok) return refuse(400, parsed.error, typed);

		const created = tickets.create({ userId: locals.user.id, message: parsed.value.message });

		if (!created.ok) {
			// The refusal is the whole log line: what somebody wrote is theirs, and the count is ours.
			log.info('support_ticket_rate_limited', {
				requestId: locals.requestId,
				userId: locals.user.id
			});

			return refuse(429, rateLimitMessage(created.error.retryAfterSec), typed);
		}

		// Ids only. The message is a private description of somebody's problem (CLAUDE.md 2).
		log.info('support_ticket_created', {
			requestId: locals.requestId,
			ticketId: created.value.id,
			userId: locals.user.id
		});

		// tech.md 11: "Отправили, админ ответит в личку". The field comes back empty with it.
		return { ok: true, message: null, text: '' } satisfies TicketResult;
	}
} satisfies Actions;
