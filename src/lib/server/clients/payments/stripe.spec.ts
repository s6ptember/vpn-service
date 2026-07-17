import { beforeEach, describe, expect, it } from 'vitest';
import { PaymentSignatureError } from '$lib/server/errors';
import { makeOrder, makeUser, PLAN_SNAPSHOT } from './fixtures';
import { StripePayments, type CheckoutSessionCreateParams, type StripeGateway } from './stripe';

const WEBHOOK_SECRET = 'whsec_test_secret';

interface StripeEventLike {
	id: string;
	type: string;
	data: { object: unknown };
}

/** Stands in for the SDK. Nothing in this spec touches the network. */
class StripeStub implements StripeGateway {
	readonly created: CheckoutSessionCreateParams[] = [];
	readonly constructed: Array<{ rawBody: string; signature: string; secret: string }> = [];

	session: { id: string; url: string | null } = {
		id: 'cs_test_123',
		url: 'https://checkout.stripe.com/c/pay/cs_test_123'
	};
	event: StripeEventLike = { id: 'evt_1', type: 'ping', data: { object: {} } };
	signatureError: Error | null = null;

	checkout = {
		sessions: {
			create: async (params: CheckoutSessionCreateParams) => {
				this.created.push(params);
				return this.session;
			}
		}
	};

	webhooks = {
		constructEvent: (rawBody: string, signature: string, secret: string): StripeEventLike => {
			this.constructed.push({ rawBody, signature, secret });
			if (this.signatureError) throw this.signatureError;
			return this.event;
		}
	};
}

function sessionObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 'cs_test_123',
		client_reference_id: 'ord_9aBcD',
		payment_status: 'paid',
		payment_intent: 'pi_test_555',
		amount_total: 800,
		currency: 'usd',
		metadata: { orderId: '42', publicId: 'ord_9aBcD' },
		...overrides
	};
}

describe('StripePayments.createCheckout', () => {
	let stripe: StripeStub;
	let payments: StripePayments;

	beforeEach(() => {
		stripe = new StripeStub();
		payments = new StripePayments({
			secretKey: 'sk_test_x',
			webhookSecret: WEBHOOK_SECRET,
			priceCurrency: 'usd',
			returnDeeplink: 'https://t.me/vpnbot/app',
			stripe
		});
	});

	it('charges the server-side price, never a number the client could have touched', async () => {
		const order = makeOrder({ basePriceMinor: 1000, discountMinor: 200, finalPriceMinor: 800 });

		await payments.createCheckout(order, PLAN_SNAPSHOT, makeUser());

		const [params] = stripe.created;
		expect(params.line_items[0].price_data.unit_amount).toBe(800);
		expect(params.line_items[0].quantity).toBe(1);
		expect(params.line_items[0].price_data.currency).toBe('usd');
	});

	it('carries no Stripe discount: the coupon system stays ours', async () => {
		await payments.createCheckout(makeOrder(), PLAN_SNAPSHOT, makeUser());

		const [params] = stripe.created;
		expect(params).not.toHaveProperty('discounts');
		expect(params).not.toHaveProperty('allow_promotion_codes');
	});

	it('anchors the session to the order publicId', async () => {
		const order = makeOrder({ id: 42, publicId: 'ord_9aBcD' });

		const result = await payments.createCheckout(order, PLAN_SNAPSHOT, makeUser());

		const [params] = stripe.created;
		expect(params.mode).toBe('payment');
		expect(params.client_reference_id).toBe('ord_9aBcD');
		expect(params.metadata).toEqual({ orderId: '42', publicId: 'ord_9aBcD' });
		expect(params.success_url).toBe('https://t.me/vpnbot/app?startapp=order_ord_9aBcD');
		expect(params.cancel_url).toBe('https://t.me/vpnbot/app?startapp=cancel_ord_9aBcD');
		expect(result).toEqual({
			url: 'https://checkout.stripe.com/c/pay/cs_test_123',
			sessionId: 'cs_test_123'
		});
	});

	it('expires the link 30 minutes out, in seconds', async () => {
		const before = Math.floor(Date.now() / 1000);

		await payments.createCheckout(makeOrder(), PLAN_SNAPSHOT, makeUser());

		const after = Math.floor(Date.now() / 1000);
		const [params] = stripe.created;
		expect(params.expires_at).toBeGreaterThanOrEqual(before + 30 * 60);
		expect(params.expires_at).toBeLessThanOrEqual(after + 30 * 60);
	});

	it('creates a Stripe customer only for a user who has none yet', async () => {
		await payments.createCheckout(makeOrder(), PLAN_SNAPSHOT, makeUser({ stripeCustomerId: null }));
		await payments.createCheckout(
			makeOrder(),
			PLAN_SNAPSHOT,
			makeUser({ stripeCustomerId: 'cus_existing' })
		);

		const [fresh, returning] = stripe.created;
		expect(fresh.customer).toBeUndefined();
		expect(fresh.customer_creation).toBe('always');
		expect(returning.customer).toBe('cus_existing');
		expect(returning.customer_creation).toBeUndefined();
	});
});

describe('StripePayments.parseWebhook', () => {
	let stripe: StripeStub;
	let payments: StripePayments;

	beforeEach(() => {
		stripe = new StripeStub();
		payments = new StripePayments({
			secretKey: 'sk_test_x',
			webhookSecret: WEBHOOK_SECRET,
			priceCurrency: 'usd',
			returnDeeplink: 'https://t.me/vpnbot/app',
			stripe
		});
	});

	it('verifies the signature against the raw body before anything else', () => {
		stripe.event = { id: 'evt_2', type: 'ping', data: { object: {} } };

		payments.parseWebhook('{"raw":true}', 'sig_header');

		expect(stripe.constructed).toEqual([
			{ rawBody: '{"raw":true}', signature: 'sig_header', secret: WEBHOOK_SECRET }
		]);
	});

	it('rejects a body Stripe did not sign', () => {
		stripe.signatureError = new Error('No signatures found matching the expected signature');

		expect(() => payments.parseWebhook('{}', 'forged')).toThrow(PaymentSignatureError);
	});

	it('treats a completed session as paid once the money actually landed', () => {
		stripe.event = {
			id: 'evt_paid',
			type: 'checkout.session.completed',
			data: { object: sessionObject({ payment_status: 'paid' }) }
		};

		expect(payments.parseWebhook('{}', 'sig')).toEqual({
			kind: 'paid',
			eventId: 'evt_paid',
			orderPublicId: 'ord_9aBcD',
			sessionId: 'cs_test_123',
			paymentIntentId: 'pi_test_555',
			amountMinor: 800,
			currency: 'usd'
		});
	});

	it('ignores a completed session whose deferred payment has not landed', () => {
		stripe.event = {
			id: 'evt_unpaid',
			type: 'checkout.session.completed',
			data: { object: sessionObject({ payment_status: 'unpaid', payment_intent: null }) }
		};

		expect(payments.parseWebhook('{}', 'sig')).toEqual({ kind: 'ignored', eventId: 'evt_unpaid' });
	});

	it('pays out on async_payment_succeeded', () => {
		stripe.event = {
			id: 'evt_async',
			type: 'checkout.session.async_payment_succeeded',
			data: { object: sessionObject({ payment_status: 'paid', payment_intent: { id: 'pi_obj' } }) }
		};

		const event = payments.parseWebhook('{}', 'sig');

		expect(event).toMatchObject({ kind: 'paid', eventId: 'evt_async', paymentIntentId: 'pi_obj' });
	});

	it('fails the order on async_payment_failed and on expiry', () => {
		stripe.event = {
			id: 'evt_failed',
			type: 'checkout.session.async_payment_failed',
			data: { object: sessionObject({ payment_status: 'unpaid' }) }
		};
		expect(payments.parseWebhook('{}', 'sig')).toEqual({
			kind: 'failed',
			eventId: 'evt_failed',
			orderPublicId: 'ord_9aBcD',
			reason: 'async_payment_failed'
		});

		stripe.event = {
			id: 'evt_expired',
			type: 'checkout.session.expired',
			data: { object: sessionObject({ payment_status: 'unpaid' }) }
		};
		expect(payments.parseWebhook('{}', 'sig')).toEqual({
			kind: 'failed',
			eventId: 'evt_expired',
			orderPublicId: 'ord_9aBcD',
			reason: 'expired'
		});
	});

	it('ignores every event type we did not subscribe to', () => {
		stripe.event = {
			id: 'evt_other',
			type: 'payment_intent.succeeded',
			data: { object: sessionObject() }
		};

		expect(payments.parseWebhook('{}', 'sig')).toEqual({ kind: 'ignored', eventId: 'evt_other' });
	});

	it('ignores a signed session that belongs to no order of ours', () => {
		stripe.event = {
			id: 'evt_foreign',
			type: 'checkout.session.completed',
			data: { object: sessionObject({ client_reference_id: null, metadata: {} }) }
		};

		expect(payments.parseWebhook('{}', 'sig')).toEqual({ kind: 'ignored', eventId: 'evt_foreign' });
	});
});
