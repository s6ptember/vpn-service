import { createHash } from 'node:crypto';
import { config } from '$lib/server/config';
import { clients, jobs, paymentWebhooks } from '$lib/server/container';
import { PaymentProviderError, PaymentSignatureError, toHttp } from '$lib/server/errors';
import { log } from '$lib/server/log';
import type { RequestHandler } from './$types';

/**
 * The single source of truth about payment (tech.md 10, step 7). The redirect to success_url is
 * not one: anybody can open that link by hand.
 *
 * One of the three public paths (tech.md 9). It arrives with no session by definition and
 * authenticates itself with the Stripe signature instead.
 */

/**
 * This route deliberately does NOT end in `toHttp(err)` the way the reference endpoint
 * routes/api/auth/telegram/+server.ts does. The generic mapping sends `payment_error` to 502, and
 * for a webhook the status code is not a message to a person — it is an instruction to Stripe about
 * whether to send the event again. So the three branches below are chosen by what a redelivery
 * would accomplish:
 *
 *   400 — the signature did not verify. Not from Stripe; nothing to retry, nothing to record.
 *   200 — we reached a decision. Includes decisions that are bad news (unknown order, wrong
 *         amount) and payloads no retry can fix: the same bytes would fail the same way forever.
 *   500 — we did NOT reach a decision. A dead database, a bug. Stripe redelivers, and because the
 *         whole effect sits in one transaction, the redelivery starts from a clean slate.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const requestLog = log.child({ requestId: locals.requestId });

	// tech.md 10: the signature is computed over the RAW body. Any parse before this line — even
	// request.json() to peek at the type — changes the bytes and breaks verification.
	const rawBody = await request.text();
	const signature = request.headers.get('stripe-signature') ?? '';

	if (clients.payments.id !== 'stripe') {
		/**
		 * The fake provider verifies against a constant that lives in this repository, so with
		 * PAYMENT_PROVIDER=fake this endpoint is not authenticated in any meaningful sense. That is
		 * fine in dev and in the e2e run, and it is why such a deployment sells nothing real: the
		 * checkout links it hands out point at localhost. There is no env flag to key a refusal on —
		 * see the CONTRACT GAP raised with this slice — so what is left is to make the situation
		 * impossible to miss in the logs.
		 */
		requestLog.warn('stripe_webhook_fake_provider', { provider: clients.payments.id });
	}

	try {
		const event = clients.payments.parseWebhook(rawBody, signature);

		const outcome = paymentWebhooks.handle(event);
		requestLog.info('stripe_webhook_handled', { eventId: event.eventId, outcome });

		// The body is for us reading logs; Stripe only ever looks at the status.
		return json200({ outcome });
	} catch (err) {
		if (err instanceof PaymentSignatureError) {
			// tech.md 10: signature mismatch answers 400 without a single database call.
			const { status, body } = toHttp(err, locals.requestId);
			requestLog.warn('stripe_webhook_bad_signature', { status });
			return new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		}

		if (err instanceof PaymentProviderError) {
			/**
			 * Signed by Stripe, and we cannot act on it: a paid session with no payment intent, no
			 * amount, or a currency this app does not price in. Retrying is pointless — the bytes are
			 * deterministic — but the money may already be ours, so it must alert rather than vanish.
			 */
			requestLog.error('stripe_webhook_unusable_payload', { error: err });
			alertAdmin(rawBody);
			return json200({ outcome: 'unusable' });
		}

		// Anything else means we never decided. Let it out: SvelteKit answers 500 and Stripe tries
		// again, which is the only thing that can still rescue a payment we failed to record.
		throw err;
	}
};

/**
 * One alert per distinct body. The event id is exactly what we could not read, so the body's own
 * digest stands in for it — a redelivery of the same payload hashes the same and is deduped by the
 * queue, while a second broken event still gets its own alert.
 */
function alertAdmin(rawBody: string): void {
	const digest = createHash('sha256').update(rawBody).digest('hex').slice(0, 16);
	const dedupeKey = `webhook:unusable:${digest}`;

	jobs.enqueue(
		'telegram.send_message',
		{
			chatId: config.ADMIN_CHAT_ID,
			// No body, no ids we could not verify: the log line holds the detail, this holds the alarm.
			text: `Stripe прислал подписанное событие, которое мы не смогли разобрать (${digest}). Проверьте платёж в дашборде.`,
			dedupeKey
		},
		`tg:${dedupeKey}`
	);
}

const json200 = (body: Record<string, string>) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
