import type { PlanSnapshot, Result } from '$lib/types';
import type { UserRow } from '../db/schema';
import type { PaymentProvider } from '../clients/payments';
import type { Logger } from '../log';
import type { PlanService } from '../plans';
import type { OrderService } from './order-service';
import type { PriceCalculator } from './price-calculator';

/**
 * The plan is gone, hidden or archived — a stale card, not an attack and not a bug, so it comes
 * back as a Result for the page to phrase (CLAUDE.md 3).
 */
export type CheckoutError = 'plan_unavailable';

export interface CheckoutStarted {
	/** Hosted checkout page. The client hands it to WebApp.openLink; it is never opened in-frame. */
	url: string;
	orderId: number;
}

/**
 * Turns "I want this plan" into an order and a payment link (tech.md 10, steps 1-4).
 *
 * The one rule this class exists to enforce: **the server prices the order**. It takes a plan id
 * and nothing else — no amount, no currency, no discount. Anything a form could say about money is
 * ignored by construction, because there is nowhere in this signature to say it (CLAUDE.md 2).
 */
export class CheckoutService {
	constructor(
		private readonly orders: OrderService,
		private readonly plans: PlanService,
		private readonly prices: PriceCalculator,
		private readonly payments: PaymentProvider,
		private readonly log: Logger
	) {}

	async start(user: UserRow, planId: number): Promise<Result<CheckoutStarted, CheckoutError>> {
		const plan = this.plans.findSellable(planId);
		if (!plan) return { ok: false, error: 'plan_unavailable' };

		const snapshot: PlanSnapshot = {
			name: plan.name,
			durationDays: plan.durationDays,
			priceMinor: plan.priceMinor,
			currency: plan.currency,
			trafficLimitBytes: plan.trafficLimitBytes
		};

		// Promo codes arrive in A10. Until then every quote is the plain price, and the column that
		// records the discount is already here so the shape does not change under them.
		const quote = this.prices.quote(snapshot, null);

		const order = this.orders.create({
			userId: user.id,
			planId: plan.id,
			plan: snapshot,
			quote,
			provider: this.payments.id
		});

		let checkout: { url: string; sessionId: string };
		try {
			checkout = await this.payments.createCheckout(order, snapshot, user);
		} catch (error) {
			/**
			 * The order exists and the provider never gave us a page for it. Left at `pending` it
			 * would sit at the top of the person's history forever, and the "Ждём оплату" screen —
			 * which reads the latest order — would wait for a payment that can never arrive.
			 *
			 * Cancelling is a local write, so it stands even though the throw is rethrown: the
			 * caller still has to hear that checkout failed.
			 */
			this.orders.settle(order.id, 'canceled');
			this.log.error('checkout_create_failed', { orderId: order.id, planId: plan.id, error });
			throw error;
		}

		this.orders.attachSession(order.id, checkout.sessionId);

		// Ids only, and no url: the checkout link is a bearer token for a payment page.
		this.log.info('checkout_created', {
			orderId: order.id,
			userId: user.id,
			planId: plan.id,
			finalPriceMinor: quote.finalPriceMinor
		});

		return { ok: true, value: { url: checkout.url, orderId: order.id } };
	}
}
