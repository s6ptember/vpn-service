import { beforeEach, describe, expect, it } from 'vitest';
import { OrderService, PriceCalculator } from '../billing';
import { addPlan, addUser } from '../billing/fixtures';
import type { Db } from '../db/client';
import type { PlanRow, UserRow } from '../db/schema';
import { createTestDb, TestClock } from '../jobs/fixtures';
import { PlanService } from '../plans';
import { DAY_MS } from './expiry';
import { SubscriptionReader } from './subscription-reader';
import { SubscriptionService } from './subscription-service';

/**
 * `awaitingKey` is the flag that keeps the profile from greeting somebody who has just paid with
 * «Подписки нет» and an invitation to buy. Paying and having a usable key are two different
 * moments — the webhook only queues the provision job — and this is where the app learns to tell
 * them apart.
 */

let db: Db;
let clock: TestClock;
let orders: OrderService;
let subscriptions: SubscriptionService;
let reader: SubscriptionReader;
let user: UserRow;
let plan: PlanRow;

const snapshot = (durationDays = 30) => ({
	name: `${durationDays} дней`,
	durationDays,
	priceMinor: 499,
	currency: 'usd' as const,
	trafficLimitBytes: 0
});

function pay(durationDays = 30) {
	const order = orders.create({
		userId: user.id,
		planId: plan.id,
		plan: snapshot(durationDays),
		quote: new PriceCalculator().quote(snapshot(durationDays), null),
		provider: 'fake'
	});

	orders.markPaid({
		orderId: order.id,
		paymentIntentId: `pi_${order.id}`,
		sessionId: `cs_${order.id}`
	});
	return orders.findById(order.id)!;
}

/** What the provision job would write for the term that ends `expiresAtMs`. */
function provision(expiresAtMs: number) {
	subscriptions.upsert({
		userId: user.id,
		planId: plan.id,
		marzbanUsername: `tg_${user.telegramId}`,
		subscriptionUrl: `https://sub.local/sub/tg_${user.telegramId}`,
		startsAtMs: clock.now(),
		expiresAtMs,
		status: 'active'
	});
}

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock();
	orders = new OrderService(db, { now: clock.now });
	subscriptions = new SubscriptionService(db, { now: clock.now });
	reader = new SubscriptionReader(subscriptions, orders, new PlanService(db, 'usd'), {
		now: clock.now
	});

	user = addUser(db);
	plan = addPlan(db);
});

describe('SubscriptionReader.forUser', () => {
	it('says there is nothing to wait for when nobody has bought anything', () => {
		expect(reader.forUser(user.id)).toEqual({
			subscription: null,
			latestOrder: null,
			awaitingKey: false
		});
	});

	it('waits while a paid order has no subscription behind it yet', () => {
		pay();

		const view = reader.forUser(user.id);

		expect(view.latestOrder?.status).toBe('paid');
		expect(view.subscription).toBeNull();
		// The window between the webhook and the worker. The profile must not offer to sell here.
		expect(view.awaitingKey).toBe(true);
	});

	it('stops waiting once the subscription covers the order', () => {
		const order = pay(30);
		provision(order.paidAt!.getTime() + 30 * DAY_MS);

		const view = reader.forUser(user.id);

		expect(view.awaitingKey).toBe(false);
		expect(view.subscription).toMatchObject({
			planName: '30 дней',
			status: 'active',
			daysLeft: 30
		});
	});

	it('keeps waiting when the row is still the one from the PREVIOUS purchase', () => {
		// The renewal case, and the reason this is arithmetic rather than "is there a row at all":
		// somebody with live access buys again, and until the job runs the row is a term short.
		const first = pay(30);
		provision(first.paidAt!.getTime() + 30 * DAY_MS);

		clock.advance(5 * DAY_MS);
		pay(30);

		expect(reader.forUser(user.id).awaitingKey).toBe(true);
	});

	it('has nothing to wait for when the last order was never paid', () => {
		orders.create({
			userId: user.id,
			planId: plan.id,
			plan: snapshot(),
			quote: new PriceCalculator().quote(snapshot(), null),
			provider: 'fake'
		});

		const view = reader.forUser(user.id);

		expect(view.latestOrder?.status).toBe('pending');
		expect(view.awaitingKey).toBe(false);
	});

	it('reports an elapsed subscription as expired however the row is flagged', () => {
		const order = pay(30);
		provision(order.paidAt!.getTime() + 30 * DAY_MS);

		// The sweep job runs every five minutes; between the lapse and the sweep the column lies.
		clock.advance(31 * DAY_MS);

		expect(reader.forUser(user.id).subscription).toMatchObject({ status: 'expired', daysLeft: 0 });
	});

	it('answers only about the person it was asked about', () => {
		pay();
		const stranger = addUser(db, { telegramId: 700_000_999, username: 'someone_else' });

		// The subscription URL is the key itself (tech.md 7). It travels by user id and nothing else.
		expect(reader.forUser(stranger.id)).toEqual({
			subscription: null,
			latestOrder: null,
			awaitingKey: false
		});
	});
});
