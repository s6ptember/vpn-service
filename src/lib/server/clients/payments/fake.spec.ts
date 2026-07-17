import { beforeEach, describe, expect, it } from 'vitest';
import { PaymentProviderError, PaymentSignatureError } from '$lib/server/errors';
import { FakePayments, FAKE_WEBHOOK_SECRET } from './fake';
import { makeOrder, makeUser, PLAN_SNAPSHOT } from './fixtures';

describe('FakePayments', () => {
	let payments: FakePayments;

	beforeEach(() => {
		payments = new FakePayments();
	});

	it('hands back a dev link and records the checkout', async () => {
		const order = makeOrder({ publicId: 'ord_9aBcD', finalPriceMinor: 800 });

		const result = await payments.createCheckout(order, PLAN_SNAPSHOT, makeUser());

		expect(result).toEqual({
			url: 'http://localhost:5173/dev/pay/ord_9aBcD',
			sessionId: 'cs_fake_ord_9aBcD'
		});
		expect(payments.checkouts).toHaveLength(1);
		expect(payments.checkouts[0]).toMatchObject({
			orderId: 42,
			publicId: 'ord_9aBcD',
			amountMinor: 800,
			currency: 'usd'
		});
	});

	it('refuses an order Stripe itself would decline', async () => {
		const order = makeOrder({ finalPriceMinor: 10 }); // usd minimum is 50

		await expect(payments.createCheckout(order, PLAN_SNAPSHOT, makeUser())).rejects.toThrow(
			PaymentProviderError
		);
	});

	it('builds a paid event that carries the order and the charged amount', async () => {
		const order = makeOrder({ publicId: 'ord_9aBcD', finalPriceMinor: 800 });
		await payments.createCheckout(order, PLAN_SNAPSHOT, makeUser());

		const event = payments.simulatePaid('ord_9aBcD');

		expect(event).toMatchObject({
			kind: 'paid',
			orderPublicId: 'ord_9aBcD',
			sessionId: 'cs_fake_ord_9aBcD',
			paymentIntentId: 'pi_fake_ord_9aBcD',
			amountMinor: 800,
			currency: 'usd'
		});
		expect(event.eventId).toMatch(/^evt_fake_/);
	});

	it('keeps the payment intent stable so a redelivery collides exactly as Stripe would', async () => {
		await payments.createCheckout(makeOrder(), PLAN_SNAPSHOT, makeUser());

		const first = payments.simulatePaid('ord_9aBcD');
		const second = payments.simulatePaid('ord_9aBcD');

		expect(first).toMatchObject({ kind: 'paid', paymentIntentId: 'pi_fake_ord_9aBcD' });
		expect(second).toMatchObject({ kind: 'paid', paymentIntentId: 'pi_fake_ord_9aBcD' });
		expect(first.eventId).not.toBe(second.eventId);
	});

	it('builds a failed event with the reason', async () => {
		await payments.createCheckout(makeOrder(), PLAN_SNAPSHOT, makeUser());

		expect(payments.simulateFailed('ord_9aBcD', 'expired')).toMatchObject({
			kind: 'failed',
			orderPublicId: 'ord_9aBcD',
			reason: 'expired'
		});
	});

	it('will not invent a payment for an order that never checked out', () => {
		expect(() => payments.simulatePaid('ord_unknown')).toThrow(PaymentProviderError);
	});

	it('fails exactly once per failNext, then works again', async () => {
		payments.failNext('timeout');
		await expect(payments.createCheckout(makeOrder(), PLAN_SNAPSHOT, makeUser())).rejects.toThrow(
			PaymentProviderError
		);
		expect(payments.checkouts).toHaveLength(0);

		const result = await payments.createCheckout(makeOrder(), PLAN_SNAPSHOT, makeUser());
		expect(result.sessionId).toBe('cs_fake_ord_9aBcD');
	});

	it('round-trips the event our dev page posts back', async () => {
		await payments.createCheckout(makeOrder(), PLAN_SNAPSHOT, makeUser());
		const event = payments.simulatePaid('ord_9aBcD');

		expect(payments.parseWebhook(JSON.stringify(event), FAKE_WEBHOOK_SECRET)).toEqual(event);
	});

	it('rejects a body signed with the wrong secret', () => {
		expect(() => payments.parseWebhook('{"kind":"ignored","eventId":"evt_1"}', 'nope')).toThrow(
			PaymentSignatureError
		);
	});

	it('rejects a signed body that is not a PaymentEvent', () => {
		expect(() => payments.parseWebhook('{"kind":"paid"}', FAKE_WEBHOOK_SECRET)).toThrow(
			PaymentProviderError
		);
	});

	it('forgets everything on reset', async () => {
		await payments.createCheckout(makeOrder(), PLAN_SNAPSHOT, makeUser());

		payments.reset();

		expect(payments.checkouts).toHaveLength(0);
	});
});
