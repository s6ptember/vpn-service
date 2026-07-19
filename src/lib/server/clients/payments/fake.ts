import { timingSafeEqual } from 'node:crypto';
import * as v from 'valibot';
import { PaymentProviderError, PaymentSignatureError } from '$lib/server/errors';
import type { OrderRow, UserRow } from '$lib/server/db/schema';
import { CURRENCIES, MIN_CHARGE_MINOR, type Currency, type PlanSnapshot } from '$lib/types';
import type { PaymentEvent, PaymentProvider } from './types';

/**
 * Shared with the dev pay page. This is NOT security: it only keeps the fake shape-compatible
 * with StripePayments so the webhook route runs one code path in dev and in production.
 * The real barrier is Stripe's signature, and this provider never ships with PAYMENT_PROVIDER=stripe.
 */
export const FAKE_WEBHOOK_SECRET = 'whsec_fake_dev_secret';

export interface FakeCheckout {
	orderId: number;
	userId: number;
	publicId: string;
	sessionId: string;
	url: string;
	amountMinor: number;
	currency: Currency;
	plan: PlanSnapshot;
}

export type PaymentFailMode = 'timeout' | 500;

const PaymentEventSchema = v.variant('kind', [
	v.object({
		kind: v.literal('paid'),
		eventId: v.string(),
		orderPublicId: v.string(),
		sessionId: v.string(),
		paymentIntentId: v.string(),
		amountMinor: v.number(),
		currency: v.picklist(CURRENCIES)
	}),
	v.object({
		kind: v.literal('failed'),
		eventId: v.string(),
		orderPublicId: v.string(),
		reason: v.string()
	}),
	v.object({ kind: v.literal('ignored'), eventId: v.string() })
]);

export class FakePayments implements PaymentProvider {
	readonly id = 'fake';

	/** Checkouts created so far, in order. Tests read this instead of Stripe's dashboard. */
	readonly checkouts: FakeCheckout[] = [];

	#nextEventSeq = 0;
	#failNext: PaymentFailMode | null = null;

	async createCheckout(
		order: OrderRow,
		plan: PlanSnapshot,
		user: UserRow
	): Promise<{ url: string; sessionId: string }> {
		// The fake is the test seam: an order Stripe would reject must fail here, in dev, loudly.
		if (order.publicId.length === 0) {
			throw new PaymentProviderError(`order ${order.id} has no publicId`);
		}
		const minimum = MIN_CHARGE_MINOR[plan.currency];
		if (order.finalPriceMinor < minimum) {
			throw new PaymentProviderError(
				`order ${order.publicId} charges ${order.finalPriceMinor}, below the ${plan.currency} minimum of ${minimum}`
			);
		}

		const mode = this.#failNext;
		this.#failNext = null;
		if (mode !== null) throw failure(mode);

		const checkout: FakeCheckout = {
			orderId: order.id,
			userId: user.id,
			publicId: order.publicId,
			sessionId: `cs_fake_${order.publicId}`,
			url: `http://localhost:5173/dev/pay/${order.publicId}`,
			amountMinor: order.finalPriceMinor,
			currency: plan.currency,
			plan
		};
		this.checkouts.push(checkout);

		return { url: checkout.url, sessionId: checkout.sessionId };
	}

	parseWebhook(rawBody: string, signature: string): PaymentEvent {
		if (!secretMatches(signature)) {
			throw new PaymentSignatureError('fake webhook signature mismatch');
		}

		let body: unknown;
		try {
			body = JSON.parse(rawBody);
		} catch (cause) {
			throw new PaymentProviderError('fake webhook body is not valid json', { cause });
		}

		const result = v.safeParse(PaymentEventSchema, body);
		if (!result.success) throw new PaymentProviderError('fake webhook body is not a PaymentEvent');

		const event = result.output;

		/**
		 * A paid event must describe a checkout this process actually opened, down to the session id
		 * and the amount. Stripe's signature carries that guarantee for real; FAKE_WEBHOOK_SECRET is
		 * a constant in this repository and carries none, so without this check the endpoint would
		 * accept any JSON anybody cared to write and mint a subscription from it.
		 *
		 * It narrows the hole rather than closing it — see the CONTRACT GAP filed with this slice
		 * about there being no env flag that keeps PAYMENT_PROVIDER=fake out of a real deployment.
		 */
		if (event.kind === 'paid') {
			const checkout = this.checkouts.find((entry) => entry.publicId === event.orderPublicId);

			if (!checkout) {
				throw new PaymentProviderError(`fake webhook names an order nobody checked out`);
			}
			if (
				event.sessionId !== checkout.sessionId ||
				event.amountMinor !== checkout.amountMinor ||
				event.currency !== checkout.currency
			) {
				throw new PaymentProviderError('fake webhook contradicts the checkout it names');
			}
		}

		return event;
	}

	/** Builds the event Stripe would have sent, so e2e walks the whole path with zero Stripe traffic. */
	simulatePaid(publicId: string): PaymentEvent {
		const checkout = this.#require(publicId);
		return {
			kind: 'paid',
			eventId: this.#nextEventId(publicId),
			orderPublicId: publicId,
			sessionId: checkout.sessionId,
			// Stable per order: it is the payment idempotency anchor, and a redelivered payment
			// must collide on orders.providerPaymentIntentId exactly as it would in production.
			paymentIntentId: `pi_fake_${publicId}`,
			amountMinor: checkout.amountMinor,
			currency: checkout.currency
		};
	}

	simulateFailed(publicId: string, reason: string): PaymentEvent {
		this.#require(publicId);
		return {
			kind: 'failed',
			eventId: this.#nextEventId(publicId),
			orderPublicId: publicId,
			reason
		};
	}

	/** Arms the next createCheckout to fail once. Error paths are tested through this. */
	failNext(mode: PaymentFailMode): void {
		this.#failNext = mode;
	}

	reset(): void {
		this.checkouts.length = 0;
		this.#nextEventSeq = 0;
		this.#failNext = null;
	}

	#require(publicId: string): FakeCheckout {
		const checkout = this.checkouts.find((entry) => entry.publicId === publicId);
		if (!checkout) throw new PaymentProviderError(`no fake checkout for order ${publicId}`);
		return checkout;
	}

	#nextEventId(publicId: string): string {
		return `evt_fake_${publicId}_${++this.#nextEventSeq}`;
	}
}

function secretMatches(signature: string): boolean {
	const provided = Buffer.from(signature);
	const expected = Buffer.from(FAKE_WEBHOOK_SECRET);
	return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function failure(mode: PaymentFailMode): PaymentProviderError {
	return mode === 'timeout'
		? new PaymentProviderError('checkout session create timed out')
		: new PaymentProviderError('payment provider answered 500');
}
