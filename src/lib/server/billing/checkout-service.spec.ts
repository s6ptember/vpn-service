import { beforeEach, describe, expect, it } from 'vitest';
import { FakePayments } from '../clients/payments';
import type { Db } from '../db/client';
import { PaymentProviderError } from '../errors';
import { createTestDb, silentLogger, TestClock } from '../jobs/fixtures';
import { PlanService } from '../plans';
import { CheckoutService } from './checkout-service';
import { addPlan, addUser } from './fixtures';
import { OrderService } from './order-service';
import { PriceCalculator } from './price-calculator';

/**
 * A5's acceptance criteria (tech.md 16, 10 steps 1-4): the server recomputes the price, writes an
 * order, asks the provider for a link and hands that link back. FakePayments is the seam — tech.md 8
 * makes it validate what a slice sends, so an order Stripe would reject fails here instead of in
 * production.
 */

let db: Db;
let clock: TestClock;
let payments: FakePayments;
let orders: OrderService;
let checkout: CheckoutService;

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock();
	payments = new FakePayments();
	orders = new OrderService(db, { now: clock.now });
	checkout = new CheckoutService(
		orders,
		new PlanService(db, 'usd', { now: clock.now }),
		new PriceCalculator(),
		payments,
		silentLogger()
	);
});

describe('CheckoutService.start', () => {
	it('prices the order from the plan, not from anything a form could say', async () => {
		const user = addUser(db);
		const plan = addPlan(db, { priceMinor: 499 });

		const started = await checkout.start(user, plan.id);

		expect(started.ok).toBe(true);
		const order = orders.findById(started.ok ? started.value.orderId : 0)!;

		// The only input was a plan id. Everything about money came off the plan row.
		expect(order.basePriceMinor).toBe(499);
		expect(order.discountMinor).toBe(0);
		expect(order.finalPriceMinor).toBe(499);
		expect(order.currency).toBe('usd');
		expect(order.status).toBe('pending');
	});

	it('freezes what was sold, so a later rename cannot rewrite the receipt', async () => {
		const user = addUser(db);
		const plan = addPlan(db, { name: '30 дней', durationDays: 30, priceMinor: 499 });

		const started = await checkout.start(user, plan.id);
		const order = orders.findById(started.ok ? started.value.orderId : 0)!;

		expect(order.planSnapshot).toEqual({
			name: '30 дней',
			durationDays: 30,
			priceMinor: 499,
			currency: 'usd',
			trafficLimitBytes: 0
		});
	});

	it('records the session the provider opened, so a webhook can be traced to the order', async () => {
		const user = addUser(db);
		const plan = addPlan(db);

		const started = await checkout.start(user, plan.id);
		const order = orders.findById(started.ok ? started.value.orderId : 0)!;

		expect(payments.checkouts).toHaveLength(1);
		expect(order.providerSessionId).toBe(payments.checkouts[0].sessionId);
		expect(order.provider).toBe('fake');
		expect(started.ok && started.value.url).toBe(payments.checkouts[0].url);
	});

	it('gives every order its own public id', async () => {
		const user = addUser(db);
		const plan = addPlan(db);

		const first = await checkout.start(user, plan.id);
		const second = await checkout.start(user, plan.id);

		const a = orders.findById(first.ok ? first.value.orderId : 0)!;
		const b = orders.findById(second.ok ? second.value.orderId : 0)!;

		expect(a.publicId).not.toBe(b.publicId);
		// It rides in a Telegram deeplink as startapp=order_<publicId>, which accepts these only.
		expect(a.publicId).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('refuses to sell a hidden plan', async () => {
		const user = addUser(db);
		const plan = addPlan(db, { isActive: false });

		const started = await checkout.start(user, plan.id);

		expect(started).toEqual({ ok: false, error: 'plan_unavailable' });
		expect(payments.checkouts).toHaveLength(0);
	});

	it('refuses to sell an archived plan, however stale the page that asked', async () => {
		const user = addUser(db);
		const plan = addPlan(db, { archivedAt: new Date(1_784_000_000_000) });

		const started = await checkout.start(user, plan.id);

		expect(started).toEqual({ ok: false, error: 'plan_unavailable' });
	});

	it('refuses a plan id that names nothing', async () => {
		const user = addUser(db);
		addPlan(db);

		expect(await checkout.start(user, 9999)).toEqual({ ok: false, error: 'plan_unavailable' });
	});

	it('cancels the order when the provider will not open a session', async () => {
		const user = addUser(db);
		const plan = addPlan(db);
		payments.failNext('timeout');

		await expect(checkout.start(user, plan.id)).rejects.toBeInstanceOf(PaymentProviderError);

		// Left pending, this order would sit at the top of the person's history forever and the
		// "Ждём оплату" screen would wait for a payment that can never arrive.
		const order = orders.latest(user.id)!;
		expect(order.status).toBe('canceled');
		expect(order.providerSessionId).toBeNull();
	});
});
