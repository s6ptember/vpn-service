import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { PlanSnapshot, PriceQuote } from '$lib/types';
import type { Db } from '../db/client';
import { orders, type OrderRow } from '../db/schema';

export interface CreateOrderInput {
	userId: number;
	planId: number;
	plan: PlanSnapshot;
	quote: PriceQuote;
	provider: 'stripe' | 'fake';
	promoCodeId?: number | null;
}

export interface MarkPaidInput {
	orderId: number;
	paymentIntentId: string;
	sessionId: string;
}

export interface OrderServiceOptions {
	now?: () => number;
	/** Injected so a test can pin the public id and assert on it instead of matching a regex. */
	newPublicId?: () => string;
}

/**
 * The `orders` table, owned by one class. It knows nothing about Stripe, about HTTP or about
 * subscriptions: it writes rows and reports what state they are in, and every caller above it
 * decides what that means.
 *
 * Every method is synchronous, like the rest of the better-sqlite3 code in this repo. That matters
 * here more than elsewhere: PaymentWebhookService runs several of these inside one
 * `db.transaction({ behavior: 'immediate' })`, and they join that transaction only because they run
 * on the same connection with nothing awaited in between.
 */
export class OrderService {
	private readonly now: () => number;
	private readonly newPublicId: () => string;

	constructor(
		private readonly db: Db,
		opts: OrderServiceOptions = {}
	) {
		this.now = opts.now ?? Date.now;
		// nanoid, per tech.md 5. It travels in the Telegram deeplink as `startapp=order_<publicId>`,
		// and nanoid's alphabet (A-Za-z0-9_-) is exactly what start_param accepts.
		this.newPublicId = opts.newPublicId ?? nanoid;
	}

	/**
	 * Opens an order at `pending`. The price comes in as a quote the server computed — this class
	 * never recomputes it and never reads one off a form (CLAUDE.md 2).
	 *
	 * planSnapshot freezes what was sold. The plan may be renamed, repriced or archived tomorrow,
	 * and the receipt for this order still has to describe what the person actually bought.
	 */
	create(input: CreateOrderInput): OrderRow {
		return this.db
			.insert(orders)
			.values({
				userId: input.userId,
				planId: input.planId,
				promoCodeId: input.promoCodeId ?? null,
				planSnapshot: input.plan,
				basePriceMinor: input.quote.basePriceMinor,
				discountMinor: input.quote.discountMinor,
				finalPriceMinor: input.quote.finalPriceMinor,
				currency: input.quote.currency,
				status: 'pending',
				provider: input.provider,
				publicId: this.newPublicId(),
				createdAt: new Date(this.now())
			})
			.returning()
			.get();
	}

	findById(id: number): OrderRow | null {
		return this.db.select().from(orders).where(eq(orders.id, id)).get() ?? null;
	}

	/** The only handle the outside world gets: it is what rides in client_reference_id. */
	findByPublicId(publicId: string): OrderRow | null {
		return this.db.select().from(orders).where(eq(orders.publicId, publicId)).get() ?? null;
	}

	/** Written as soon as the provider names the session, so a webhook can be traced back to it. */
	attachSession(orderId: number, sessionId: string): void {
		this.db
			.update(orders)
			.set({ providerSessionId: sessionId })
			.where(eq(orders.id, orderId))
			.run();
	}

	/**
	 * Confirms payment. The WHERE clause carries `status = 'pending'`, so a redelivered webhook
	 * updates nothing and reports it: that, plus the unique index on providerPaymentIntentId, is the
	 * second of the two barriers tech.md 10 asks for.
	 *
	 * Returns the row as it now stands, or null if the order is gone.
	 */
	markPaid(input: MarkPaidInput): { row: OrderRow | null; changed: boolean } {
		const paidAt = new Date(this.now());

		const row = this.db
			.update(orders)
			.set({
				status: 'paid',
				paidAt,
				providerPaymentIntentId: input.paymentIntentId,
				providerSessionId: input.sessionId
			})
			.where(and(eq(orders.id, input.orderId), eq(orders.status, 'pending')))
			.returning()
			.get();

		if (row) return { row, changed: true };

		// Nothing moved: either the order was already settled, or it never existed.
		return { row: this.findById(input.orderId), changed: false };
	}

	/**
	 * A settled order is never reopened. Stripe can send `expired` for a session whose payment
	 * already succeeded through the async path, and that must not revoke a paid order.
	 */
	settle(orderId: number, status: 'failed' | 'canceled'): boolean {
		const row = this.db
			.update(orders)
			.set({ status })
			.where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
			.returning()
			.get();

		return row !== undefined;
	}

	/**
	 * Every paid order of one person, oldest first. This is the input to the subscription expiry
	 * fold (subscriptions/expiry.ts) — which is why the order is `paidAt`, not `createdAt`: an order
	 * opened first can easily be paid second, and the fold has to walk the money, not the intent.
	 */
	listPaid(userId: number): OrderRow[] {
		return this.db
			.select()
			.from(orders)
			.where(and(eq(orders.userId, userId), eq(orders.status, 'paid')))
			.orderBy(asc(orders.paidAt), asc(orders.id))
			.all();
	}

	/**
	 * A12 — the purchase history, newest first. `createdAt` rather than `paidAt` because this list
	 * shows every attempt, paid or not, and an unpaid order has no payment date to sort on; the
	 * (userId, createdAt) index is on exactly this pair.
	 *
	 * Capped by the caller. Nobody scrolls a thousand receipts on a phone, and an unbounded read
	 * grows with the best customer the shop has.
	 */
	listForUser(userId: number, limit: number): OrderRow[] {
		return this.db
			.select()
			.from(orders)
			.where(eq(orders.userId, userId))
			.orderBy(desc(orders.createdAt), desc(orders.id))
			.limit(limit)
			.all();
	}

	/**
	 * This person's orders quoted with `promoCodeId` that have not been settled against them yet:
	 * still awaiting payment, or paid and not yet provisioned.
	 *
	 * PromoService counts these alongside real redemptions when it prices a checkout. The redemption
	 * row is written by the provision job, well after the money lands, so without this an order on a
	 * payment page — or one already paid and waiting for the worker — is invisible, and the same code
	 * could be spent twice. See PromoService.resolve.
	 */
	countUnsettledWithPromo(userId: number, promoCodeId: number): number {
		const row = this.db
			.select({ count: sql<number>`count(*)` })
			.from(orders)
			.where(
				and(
					eq(orders.userId, userId),
					eq(orders.promoCodeId, promoCodeId),
					inArray(orders.status, ['pending', 'paid'])
				)
			)
			.get();

		return row?.count ?? 0;
	}

	/** The order the person is most likely looking at right now. Drives the "Ждём оплату" screen. */
	latest(userId: number): OrderRow | null {
		return (
			this.db
				.select()
				.from(orders)
				.where(eq(orders.userId, userId))
				.orderBy(desc(orders.createdAt), desc(orders.id))
				.limit(1)
				.get() ?? null
		);
	}
}
