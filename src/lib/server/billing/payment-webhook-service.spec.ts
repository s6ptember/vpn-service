import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PaymentEvent } from '../clients/payments';
import type { Db } from '../db/client';
import { jobs as jobsTable, orders as ordersTable, webhookEvents } from '../db/schema';
import { createTestDb, silentLogger, TestClock } from '../jobs/fixtures';
import { JobQueue } from '../jobs/queue';
import { addPlan, addUser } from './fixtures';
import { OrderService } from './order-service';
import { PaymentWebhookService } from './payment-webhook-service';
import { PriceCalculator } from './price-calculator';

/**
 * A6's acceptance criteria, tech.md 10 step 8: dedupe by eventId, check amount_total and currency
 * against the order, anchor payment idempotency on providerPaymentIntentId, enqueue the provision
 * and answer fast.
 *
 * The tests are written from those criteria, so each one names the harm it prevents: a redelivered
 * webhook granting a second subscription, a tampered amount buying access, a rolled-back payment
 * being deduped away by its own dedupe row.
 */

let db: Db;
let clock: TestClock;
let orders: OrderService;
let queue: JobQueue;
let service: PaymentWebhookService;

/** One person, one plan, one pending order at 499 usd — the state a webhook arrives into. */
function openOrder(overrides: { finalPriceMinor?: number } = {}) {
	const user = addUser(db);
	const plan = addPlan(db, { priceMinor: overrides.finalPriceMinor ?? 499 });
	const quote = new PriceCalculator().quote(
		{
			name: plan.name,
			durationDays: plan.durationDays,
			priceMinor: plan.priceMinor,
			currency: 'usd',
			trafficLimitBytes: plan.trafficLimitBytes
		},
		null
	);

	return orders.create({
		userId: user.id,
		planId: plan.id,
		plan: {
			name: plan.name,
			durationDays: plan.durationDays,
			priceMinor: plan.priceMinor,
			currency: 'usd',
			trafficLimitBytes: plan.trafficLimitBytes
		},
		quote,
		provider: 'stripe'
	});
}

const paidEvent = (
	publicId: string,
	overrides: Partial<Extract<PaymentEvent, { kind: 'paid' }>> = {}
) =>
	({
		kind: 'paid',
		eventId: 'evt_1',
		orderPublicId: publicId,
		sessionId: `cs_${publicId}`,
		paymentIntentId: `pi_${publicId}`,
		amountMinor: 499,
		currency: 'usd',
		...overrides
	}) satisfies PaymentEvent;

/** The one person the app alerts when money arrives that it cannot turn into access. */
const ADMIN_CHAT_ID = 100_000_001;

const adminAlerts = () =>
	db.select().from(jobsTable).where(eq(jobsTable.type, 'telegram.send_message')).all();

const provisionJobs = () =>
	db.select().from(jobsTable).where(eq(jobsTable.type, 'subscription.provision')).all();

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock();
	orders = new OrderService(db, { now: clock.now });
	queue = new JobQueue(db, clock.now);
	service = new PaymentWebhookService(db, orders, queue, silentLogger(), {
		provider: 'stripe',
		adminChatId: ADMIN_CHAT_ID,
		now: clock.now
	});
});

describe('PaymentWebhookService.handle', () => {
	it('marks the order paid and queues exactly one provision', () => {
		const order = openOrder();

		expect(service.handle(paidEvent(order.publicId))).toBe('paid');

		const settled = orders.findById(order.id)!;
		expect(settled.status).toBe('paid');
		expect(settled.paidAt).toEqual(new Date(clock.now()));
		expect(settled.providerPaymentIntentId).toBe(`pi_${order.publicId}`);
		expect(settled.providerSessionId).toBe(`cs_${order.publicId}`);

		const queued = provisionJobs();
		expect(queued).toHaveLength(1);
		expect(queued[0].payload).toEqual({ orderId: order.id });
		expect(queued[0].idempotencyKey).toBe(`provision:order:${order.id}`);
	});

	it('grants nothing on a redelivery of the same event', () => {
		const order = openOrder();
		const event = paidEvent(order.publicId);

		expect(service.handle(event)).toBe('paid');
		const firstPaidAt = orders.findById(order.id)!.paidAt;

		clock.advance(60_000);
		// tech.md 10: Stripe retries and sends duplicates. This is the first barrier, the eventId.
		expect(service.handle(event)).toBe('duplicate');

		expect(orders.findById(order.id)!.paidAt).toEqual(firstPaidAt);
		expect(provisionJobs()).toHaveLength(1);
	});

	it('grants nothing when the same payment arrives under a fresh event id', () => {
		const order = openOrder();

		expect(service.handle(paidEvent(order.publicId, { eventId: 'evt_1' }))).toBe('paid');
		// A different event, same payment intent: the second barrier, orders.providerPaymentIntentId.
		expect(service.handle(paidEvent(order.publicId, { eventId: 'evt_2' }))).toBe('already_paid');

		// Still one provision. Two would be two subscriptions for one payment.
		expect(provisionJobs()).toHaveLength(1);
		expect(db.select().from(webhookEvents).all()).toHaveLength(2);
	});

	it('re-queues the provision if a first delivery died before enqueuing it', () => {
		const order = openOrder();
		service.handle(paidEvent(order.publicId, { eventId: 'evt_1' }));

		// Simulate the job row vanishing between deliveries — a crash, or an operator clearing it.
		db.delete(jobsTable).run();

		expect(service.handle(paidEvent(order.publicId, { eventId: 'evt_2' }))).toBe('already_paid');
		expect(provisionJobs()).toHaveLength(1);
	});

	it('refuses to grant access when the amount does not match the order', () => {
		const order = openOrder();

		// The server priced this at 499. A payment for less is a tampered session or our own bug.
		expect(service.handle(paidEvent(order.publicId, { amountMinor: 1 }))).toBe('amount_mismatch');

		expect(orders.findById(order.id)!.status).toBe('pending');
		expect(provisionJobs()).toHaveLength(0);

		/**
		 * Money collected, access refused, and no retry can change either — so somebody has to be
		 * told. A wrong PRICE_CURRENCY would otherwise refuse every payment the shop takes while the
		 * only trace was a log line nobody is watching.
		 */
		const alerts = adminAlerts();
		expect(alerts).toHaveLength(1);
		expect(alerts[0].payload).toMatchObject({ chatId: ADMIN_CHAT_ID });
	});

	it('alerts once per event, however many times Stripe redelivers it', () => {
		const order = openOrder();
		const event = paidEvent(order.publicId, { amountMinor: 1 });

		service.handle(event);
		service.handle(event);
		service.handle(paidEvent(order.publicId, { eventId: 'evt_2', amountMinor: 1 }));

		// Two distinct problems, two messages; a redelivery of one of them adds nothing.
		expect(adminAlerts()).toHaveLength(2);
	});

	it('alerts when a payment arrives for an order this database has never had', () => {
		expect(service.handle(paidEvent('ord_never_existed'))).toBe('unknown_order');

		expect(adminAlerts()).toHaveLength(1);
	});

	it('alerts when a payment lands on an order that was already settled another way', () => {
		const order = openOrder();
		service.handle({
			kind: 'failed',
			eventId: 'evt_expired',
			orderPublicId: order.publicId,
			reason: 'expired'
		});

		// The session expired, and then the money arrived anyway.
		expect(service.handle(paidEvent(order.publicId, { eventId: 'evt_late' }))).toBe('conflict');

		expect(orders.findById(order.id)!.status).toBe('failed');
		expect(provisionJobs()).toHaveLength(0);
		expect(adminAlerts()).toHaveLength(1);
	});

	it('refuses to grant access when the currency does not match the order', () => {
		const order = openOrder();

		expect(service.handle(paidEvent(order.publicId, { currency: 'eur' }))).toBe('amount_mismatch');

		expect(orders.findById(order.id)!.status).toBe('pending');
		expect(provisionJobs()).toHaveLength(0);
	});

	it('says so, loudly and once, when the order is not ours', () => {
		expect(service.handle(paidEvent('ord_never_existed'))).toBe('unknown_order');

		expect(provisionJobs()).toHaveLength(0);
		// The event is still recorded: a retry of it must not re-run the same fruitless search.
		expect(db.select().from(webhookEvents).all()).toHaveLength(1);
	});

	it('does nothing at all with an event Stripe sent about somebody else', () => {
		expect(service.handle({ kind: 'ignored', eventId: 'evt_unrelated' })).toBe('ignored');

		// An unrelated event must not grow the dedupe table for every webhook Stripe ever sends.
		expect(db.select().from(webhookEvents).all()).toHaveLength(0);
	});

	it('fails a pending order when the session expires', () => {
		const order = openOrder();

		const outcome = service.handle({
			kind: 'failed',
			eventId: 'evt_expired',
			orderPublicId: order.publicId,
			reason: 'expired'
		});

		expect(outcome).toBe('failed');
		expect(orders.findById(order.id)!.status).toBe('failed');
		// Stripe's own reason is what lands in the column, not our internal word for it.
		expect(db.select().from(webhookEvents).all()[0].type).toBe('expired');
	});

	it('never revokes a paid order on a late expiry event', () => {
		const order = openOrder();
		service.handle(paidEvent(order.publicId, { eventId: 'evt_paid' }));

		// Stripe expires the session after an async payment already succeeded. The money is ours.
		const outcome = service.handle({
			kind: 'failed',
			eventId: 'evt_expired',
			orderPublicId: order.publicId,
			reason: 'expired'
		});

		expect(outcome).toBe('stale');
		expect(orders.findById(order.id)!.status).toBe('paid');
	});

	it('rolls the dedupe row back when the effect throws, so the redelivery still works', () => {
		const order = openOrder();

		// A queue that blows up stands in for a disk error mid-transaction: the payment is real, the
		// write is not finished, and Stripe's redelivery is the only thing that can rescue it.
		const brokenQueue = new JobQueue(db, clock.now);
		brokenQueue.enqueue = () => {
			throw new Error('disk is on fire');
		};
		const broken = new PaymentWebhookService(db, orders, brokenQueue, silentLogger(), {
			provider: 'stripe',
			adminChatId: ADMIN_CHAT_ID,
			now: clock.now
		});

		expect(() => broken.handle(paidEvent(order.publicId))).toThrow('disk is on fire');

		// Nothing survived: not the dedupe row, and not the paid status.
		expect(db.select().from(webhookEvents).all()).toHaveLength(0);
		expect(db.select().from(ordersTable).all()[0].status).toBe('pending');

		// So the very same event, redelivered, still lands. That is the whole point of one
		// transaction: a swallowed dedupe row would have made this second delivery a no-op.
		expect(service.handle(paidEvent(order.publicId))).toBe('paid');
		expect(provisionJobs()).toHaveLength(1);
	});
});
