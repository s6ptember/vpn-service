import type { PlanSnapshot, PromoCodeDTO, PromoError, Result } from '$lib/types';
import type { UserRow } from '../db/schema';
import type { PaymentProvider } from '../clients/payments';
import type { Logger } from '../log';
import type { PlanService } from '../plans';
import type { OrderService } from './order-service';
import type { PriceCalculator } from './price-calculator';
import type { PromoService } from './promo-service';

/**
 * Every way a checkout can be refused for a reason the person can act on — a stale card, a code that
 * has run out — rather than because something broke. All of them are Results for the page to phrase
 * (CLAUDE.md 3); a provider that fell over still throws.
 *
 * Kept a flat string union so the route can map it with one exhaustive `Record<CheckoutError, …>`:
 * adding an arm without deciding what it says to the person then fails to compile.
 */
export type CheckoutError = 'plan_unavailable' | `promo_${PromoError}`;

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
		private readonly promos: PromoService,
		private readonly payments: PaymentProvider,
		private readonly log: Logger
	) {}

	/**
	 * `promoCode` is a name, not a discount. What it is worth is read from the row it names and
	 * checked against this person's history — the form has no way to say how much anything costs.
	 */
	async start(
		user: UserRow,
		planId: number,
		promoCode?: string
	): Promise<Result<CheckoutStarted, CheckoutError>> {
		const plan = this.plans.findSellable(planId);
		if (!plan) return { ok: false, error: 'plan_unavailable' };

		const snapshot: PlanSnapshot = {
			name: plan.name,
			durationDays: plan.durationDays,
			priceMinor: plan.priceMinor,
			currency: plan.currency,
			trafficLimitBytes: plan.trafficLimitBytes
		};

		let promo: PromoCodeDTO | null = null;

		if (promoCode) {
			const resolved = this.promos.resolve(promoCode, user.id);

			/**
			 * A refused code stops the purchase instead of quietly selling at full price. Somebody who
			 * typed a code is buying because of it: charging them the undiscounted amount and letting
			 * them find out on the payment page is the one outcome here that costs their trust.
			 */
			if (!resolved.ok) return { ok: false, error: `promo_${resolved.error}` };

			promo = resolved.value;
		}

		const quote = this.prices.quote(snapshot, promo);

		const order = this.orders.create({
			userId: user.id,
			planId: plan.id,
			plan: snapshot,
			quote,
			provider: this.payments.id,
			promoCodeId: promo?.id ?? null
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

		// Ids only, and no url: the checkout link is a bearer token for a payment page. The promo is
		// logged by id for the same reason — a code is a bearer secret too, and redact() masks by key
		// name, so the string itself must never be handed to the logger.
		this.log.info('checkout_created', {
			orderId: order.id,
			userId: user.id,
			planId: plan.id,
			promoCodeId: promo?.id ?? null,
			finalPriceMinor: quote.finalPriceMinor
		});

		return { ok: true, value: { url: checkout.url, orderId: order.id } };
	}
}
