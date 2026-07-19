import type { PaymentEvent } from '../clients/payments';
import type { Db } from '../db/client';
import { webhookEvents, type OrderRow } from '../db/schema';
import type { JobQueue } from '../jobs/queue';
import type { Logger } from '../log';
import type { OrderService } from './order-service';

/**
 * Every way a signed event can end. The route turns this union into a 200 — and ONLY this union:
 * anything that throws instead escapes to the route boundary and becomes a 500, so Stripe
 * redelivers it. That distinction is the whole point of enumerating the outcomes here rather than
 * wrapping the call in a catch-all: a decision we reached is success, a database that fell over is
 * not, and answering 200 to the second one loses a paid order permanently (tech.md 10).
 */
export type WebhookOutcome =
	| 'ignored'
	| 'duplicate'
	| 'paid'
	| 'already_paid'
	| 'unknown_order'
	| 'amount_mismatch'
	| 'conflict'
	| 'failed'
	| 'stale';

export interface PaymentWebhookServiceOptions {
	/** Which implementation signed the event, recorded on the dedupe row. Comes from PaymentProvider.id. */
	provider: 'stripe' | 'fake';
	now?: () => number;
}

/**
 * The only place a payment becomes a fact (tech.md 10, step 7). A redirect to success_url is not
 * one — anybody can open that link by hand.
 *
 * Everything here is synchronous on purpose. The whole decision runs inside one
 * `db.transaction({ behavior: 'immediate' })`, and better-sqlite3 refuses a transaction callback
 * that returns a promise; awaiting inside it would also hold the write lock across the await. The
 * heavy work — Marzban, Telegram — is a job, which is why Stripe gets its answer in milliseconds.
 */
export class PaymentWebhookService {
	private readonly now: () => number;
	private readonly provider: 'stripe' | 'fake';

	constructor(
		private readonly db: Db,
		private readonly orders: OrderService,
		private readonly jobs: JobQueue,
		private readonly log: Logger,
		opts: PaymentWebhookServiceOptions
	) {
		this.now = opts.now ?? Date.now;
		this.provider = opts.provider;
	}

	handle(event: PaymentEvent): WebhookOutcome {
		// Nothing to record and nothing to undo: an unrelated Stripe event never reaches the database.
		if (event.kind === 'ignored') return 'ignored';

		/**
		 * One transaction for the dedupe row AND the effect. If the effect throws, the dedupe row
		 * rolls back with it — otherwise the redelivery Stripe is about to send would be swallowed
		 * as a duplicate and the payment would be lost with the failure that caused it.
		 *
		 * BEGIN IMMEDIATE takes the write lock up front, so two deliveries of the same event cannot
		 * both read "not seen yet" and both act.
		 *
		 * `this.orders` and `this.jobs` hold the same better-sqlite3 connection as `this.db`, so
		 * their statements run inside this transaction even though they are not handed `tx`.
		 */
		return this.db.transaction(
			(tx): WebhookOutcome => {
				const inserted = tx
					.insert(webhookEvents)
					.values({
						provider: this.provider,
						eventId: event.eventId,
						// The closest thing to the provider's event type that PaymentEvent carries: a
						// failure keeps Stripe's own reason, a success is simply a success.
						type: event.kind === 'paid' ? 'paid' : event.reason,
						receivedAt: new Date(this.now())
					})
					.onConflictDoNothing({ target: webhookEvents.eventId })
					.returning()
					.get();

				// tech.md 10: Stripe retries and sends duplicates. This is the first of the two barriers.
				if (!inserted) {
					this.log.info('stripe_webhook_duplicate', { eventId: event.eventId });
					return 'duplicate';
				}

				const order = this.orders.findByPublicId(event.orderPublicId);

				if (!order) {
					// Signed by Stripe, but about an order this database has never had. A retry cannot
					// conjure one, so it is settled, loudly.
					this.log.error('stripe_webhook_unknown_order', {
						eventId: event.eventId,
						orderPublicId: event.orderPublicId
					});
					return 'unknown_order';
				}

				return event.kind === 'paid'
					? this.#grant(event, order)
					: this.#refuse(event.reason, order);
			},
			{ behavior: 'immediate' }
		);
	}

	#grant(event: Extract<PaymentEvent, { kind: 'paid' }>, order: OrderRow): WebhookOutcome {
		/**
		 * tech.md 10, step 8: the amount and the currency are checked against the order before
		 * anything is granted. The server priced this order; a payment for a different sum is either
		 * a tampered session or our own bug, and either way it must not buy a subscription.
		 */
		if (event.amountMinor !== order.finalPriceMinor || event.currency !== order.currency) {
			this.log.error('stripe_webhook_amount_mismatch', {
				eventId: event.eventId,
				orderId: order.id,
				expectedMinor: order.finalPriceMinor,
				paidMinor: event.amountMinor,
				expectedCurrency: order.currency,
				paidCurrency: event.currency
			});
			return 'amount_mismatch';
		}

		const { row, changed } = this.orders.markPaid({
			orderId: order.id,
			paymentIntentId: event.paymentIntentId,
			sessionId: event.sessionId
		});

		if (!changed) {
			// Already settled. The same payment intent means this is the redelivery tech.md 10 warns
			// about — the second barrier — and the job below is enqueued again on purpose: its
			// idempotency key makes that a no-op, and it repairs the case where the first delivery
			// died between the update and the enqueue.
			if (row?.status === 'paid' && row.providerPaymentIntentId === event.paymentIntentId) {
				this.#provision(order.id);
				return 'already_paid';
			}

			this.log.error('stripe_webhook_order_conflict', {
				eventId: event.eventId,
				orderId: order.id,
				status: row?.status ?? 'missing',
				paymentIntentId: event.paymentIntentId
			});
			return 'conflict';
		}

		this.#provision(order.id);
		this.log.info('order_paid', { orderId: order.id, userId: order.userId });

		return 'paid';
	}

	#refuse(reason: string, order: OrderRow): WebhookOutcome {
		// A paid order is never reopened: Stripe can expire a session whose async payment already
		// succeeded, and that must not revoke access somebody has paid for.
		const settled = this.orders.settle(order.id, 'failed');

		this.log.info(settled ? 'order_failed' : 'order_failed_ignored', {
			orderId: order.id,
			reason
		});

		return settled ? 'failed' : 'stale';
	}

	/** tech.md 6: one provision per order, enforced by the unique idempotency key. */
	#provision(orderId: number): void {
		this.jobs.enqueue('subscription.provision', { orderId }, `provision:order:${orderId}`);
	}
}
