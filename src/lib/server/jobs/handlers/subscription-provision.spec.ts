import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { UserService } from '$lib/server/auth/user-service';
import { OrderService, PriceCalculator, PromoService, PromoValidator } from '$lib/server/billing';
import { addPlan, addPromo, addUser } from '$lib/server/billing/fixtures';
import { FAKE_SUB_ORIGIN, FakeMarzban } from '$lib/server/clients/marzban';
import type { Db } from '$lib/server/db/client';
import {
	jobs as jobsTable,
	promoCodes,
	promoRedemptions,
	subscriptions as subscriptionsTable,
	type PlanRow,
	type UserRow
} from '$lib/server/db/schema';
import { MarzbanError } from '$lib/server/errors';
import { DAY_MS, SubscriptionService } from '$lib/server/subscriptions';
import { createTestDb, silentLogger, TestClock } from '../fixtures';
import { JobQueue } from '../queue';
import { SubscriptionProvisionHandler } from './subscription-provision';

/**
 * A8's acceptance criteria (tech.md 16 and 10 step 9): a paid order becomes a Marzban user, the
 * days extend from max(now, current expiry), the subscriptions row is written, and a message with
 * the link goes out.
 *
 * On top of them sits tech.md 6's flat requirement — two runs of the same payload leave exactly one
 * effect. That one is not decoration here: the worker deliberately re-runs a job left `running` by
 * a process that died, so a handler that added days on every run would hand out free months on
 * every deploy that landed mid-job.
 */

const ADMIN_CHAT_ID = 900_000_001;

let db: Db;
let clock: TestClock;
let orders: OrderService;
let promos: PromoService;
let subscriptions: SubscriptionService;
let marzban: FakeMarzban;
let queue: JobQueue;
let handler: SubscriptionProvisionHandler;
let user: UserRow;
let plan: PlanRow;

/** Opens an order and settles it, which is the state the webhook leaves behind. */
function payFor(durationDays: number, paidAt = clock.now(), promoCodeId: number | null = null) {
	const snapshot = {
		name: `${durationDays} дней`,
		durationDays,
		priceMinor: plan.priceMinor,
		currency: 'usd' as const,
		trafficLimitBytes: plan.trafficLimitBytes
	};

	const order = orders.create({
		userId: user.id,
		planId: plan.id,
		plan: snapshot,
		quote: new PriceCalculator().quote(snapshot, null),
		provider: 'fake',
		promoCodeId
	});

	// paidAt is what the fold anchors on, so the specs set it explicitly rather than leaning on
	// whatever the shared clock happens to say.
	const at = clock.now();
	const paidOrders = new OrderService(db, { now: () => paidAt ?? at });
	paidOrders.markPaid({
		orderId: order.id,
		paymentIntentId: `pi_${order.publicId}`,
		sessionId: `cs_${order.publicId}`
	});

	return orders.findById(order.id)!;
}

const subscriptionRow = () =>
	db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id)).get() ?? null;

const messages = () =>
	db.select().from(jobsTable).where(eq(jobsTable.type, 'telegram.send_message')).all();

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock();
	orders = new OrderService(db, { now: clock.now });
	promos = new PromoService(db, new PromoValidator(), orders, { now: clock.now });
	subscriptions = new SubscriptionService(db, { now: clock.now });
	marzban = new FakeMarzban();
	queue = new JobQueue(db, clock.now);
	handler = new SubscriptionProvisionHandler(
		orders,
		subscriptions,
		new UserService(db, { now: clock.now }),
		promos,
		marzban,
		queue,
		silentLogger(),
		{ now: clock.now, adminChatId: ADMIN_CHAT_ID }
	);

	user = addUser(db);
	plan = addPlan(db);
});

const promoRow = (id: number) => db.select().from(promoCodes).where(eq(promoCodes.id, id)).get()!;

describe('SubscriptionProvisionHandler', () => {
	it('creates the panel user and the subscription row from a paid order', async () => {
		const order = payFor(30);

		await handler.handle({ orderId: order.id });

		const marzbanUser = await marzban.getUser(`tg_${user.telegramId}`);
		expect(marzbanUser).not.toBeNull();
		expect(marzbanUser!.expiresAtMs).toBe(clock.now() + 30 * DAY_MS);
		expect(marzbanUser!.status).toBe('active');

		const row = subscriptionRow()!;
		expect(row.marzbanUsername).toBe(`tg_${user.telegramId}`);
		expect(row.subscriptionUrl).toBe(`${FAKE_SUB_ORIGIN}/sub/tg_${user.telegramId}`);
		expect(row.expiresAt.getTime()).toBe(clock.now() + 30 * DAY_MS);
		expect(row.startsAt.getTime()).toBe(clock.now());
		expect(row.status).toBe('active');
		expect(row.planId).toBe(plan.id);
	});

	it('sends one message carrying the link', async () => {
		const order = payFor(30);

		await handler.handle({ orderId: order.id });

		const queued = messages();
		expect(queued).toHaveLength(1);
		expect(queued[0].idempotencyKey).toBe(`tg:subscription:order:${order.id}`);
		expect(queued[0].payload).toMatchObject({
			chatId: user.telegramId,
			dedupeKey: `subscription:order:${order.id}`
		});
		expect(String((queued[0].payload as { text: string }).text)).toContain(
			`${FAKE_SUB_ORIGIN}/sub/tg_${user.telegramId}`
		);
	});

	/**
	 * The test tech.md 6 asks for on every handler, and the one that would fail loudest against the
	 * obvious implementation: read the row, add the days, write it back.
	 */
	it('leaves exactly one effect when it runs twice', async () => {
		const order = payFor(30);

		await handler.handle({ orderId: order.id });
		const afterFirst = subscriptionRow()!;
		const marzbanAfterFirst = await marzban.getUser(`tg_${user.telegramId}`);

		// The second run happens later, as an orphan recovery or a retry would.
		clock.advance(45_000);
		await handler.handle({ orderId: order.id });

		const afterSecond = subscriptionRow()!;
		expect(afterSecond.expiresAt).toEqual(afterFirst.expiresAt);
		expect(afterSecond.startsAt).toEqual(afterFirst.startsAt);
		expect(afterSecond.id).toBe(afterFirst.id);

		expect((await marzban.getUser(`tg_${user.telegramId}`))!.expiresAtMs).toBe(
			marzbanAfterFirst!.expiresAtMs
		);
		// One order, one message, however many times the job ran.
		expect(messages()).toHaveLength(1);
	});

	it('adds the days to a subscription that is still running', async () => {
		// tech.md 17.3: 30 days bought on top of 12 active ones give 42.
		const first = payFor(30);
		await handler.handle({ orderId: first.id });
		const firstEnd = subscriptionRow()!.expiresAt.getTime();

		clock.advance(18 * DAY_MS);
		const second = payFor(30, clock.now());
		await handler.handle({ orderId: second.id });

		expect(subscriptionRow()!.expiresAt.getTime()).toBe(firstEnd + 30 * DAY_MS);
		// Still one row: exactly one subscription per person (tech.md 17.3).
		expect(db.select().from(subscriptionsTable).all()).toHaveLength(1);
		expect(await marzban.getUser(`tg_${user.telegramId}`)).toMatchObject({
			expiresAtMs: firstEnd + 30 * DAY_MS
		});
	});

	it('restarts from the payment when the subscription had already lapsed', async () => {
		const first = payFor(7);
		await handler.handle({ orderId: first.id });

		clock.advance(30 * DAY_MS);
		const comeback = payFor(30, clock.now());
		await handler.handle({ orderId: comeback.id });

		// Nobody is owed the days they were away for.
		expect(subscriptionRow()!.expiresAt.getTime()).toBe(clock.now() + 30 * DAY_MS);
	});

	it('switches a lapsed panel user back on', async () => {
		const first = payFor(7);
		await handler.handle({ orderId: first.id });

		const username = `tg_${user.telegramId}`;
		await marzban.setStatus(username, 'disabled');

		clock.advance(30 * DAY_MS);
		const comeback = payFor(30, clock.now());
		await handler.handle({ orderId: comeback.id });

		expect((await marzban.getUser(username))!.status).toBe('active');
	});

	it('recovers when the panel already holds the user it was about to create', async () => {
		// A retry that got as far as createUser last time, or a race. 409 is the panel's answer.
		const username = `tg_${user.telegramId}`;
		marzban.seed([
			{
				username,
				status: 'active',
				expiresAtMs: clock.now() + DAY_MS,
				usedTrafficBytes: 0,
				subscriptionUrl: `${FAKE_SUB_ORIGIN}/sub/${username}`,
				links: []
			}
		]);

		const order = payFor(30);
		await handler.handle({ orderId: order.id });

		expect((await marzban.getUser(username))!.expiresAtMs).toBe(clock.now() + 30 * DAY_MS);
		expect(subscriptionRow()!.expiresAt.getTime()).toBe(clock.now() + 30 * DAY_MS);
	});

	it('recovers when createUser loses the race and the panel answers 409', async () => {
		// The branch the seeded test above cannot reach: getUser says the user is absent, so the
		// handler calls createUser, and by then somebody else has created it.
		const username = `tg_${user.telegramId}`;
		class RacingMarzban extends FakeMarzban {
			#hidden = true;
			override async getUser(name: string) {
				if (this.#hidden) {
					this.#hidden = false;
					// Arrive after our lookup, before our create: exactly the race the catch exists for.
					this.seed([
						{
							username,
							status: 'active',
							expiresAtMs: clock.now() + DAY_MS,
							usedTrafficBytes: 0,
							subscriptionUrl: `${FAKE_SUB_ORIGIN}/sub/${username}`,
							links: []
						}
					]);
					return null;
				}
				return super.getUser(name);
			}
		}

		const racing = new RacingMarzban();
		const racingHandler = new SubscriptionProvisionHandler(
			orders,
			subscriptions,
			new UserService(db, { now: clock.now }),
			promos,
			racing,
			queue,
			silentLogger(),
			{ now: clock.now, adminChatId: ADMIN_CHAT_ID }
		);

		const order = payFor(30);
		await racingHandler.handle({ orderId: order.id });

		expect((await racing.getUser(username))!.expiresAtMs).toBe(clock.now() + 30 * DAY_MS);
		expect(subscriptionRow()!.expiresAt.getTime()).toBe(clock.now() + 30 * DAY_MS);
		expect(subscriptionRow()!.marzbanUsername).toBe(username);
	});

	it('writes nothing when the panel is down, so the retry starts from a clean slate', async () => {
		const order = payFor(30);
		marzban.failNext(500);

		await expect(handler.handle({ orderId: order.id })).rejects.toBeInstanceOf(MarzbanError);

		// Marzban is the source of truth for access (tech.md 1). A row claiming access the panel
		// never granted would be a promise we cannot keep.
		expect(subscriptionRow()).toBeNull();
		expect(messages()).toHaveLength(0);

		// And the retry succeeds without any repair step.
		await handler.handle({ orderId: order.id });
		expect(subscriptionRow()).not.toBeNull();
	});

	it('does not eat the promo code while the panel is down', async () => {
		/**
		 * Why the redemption runs after the panel call rather than before it. A Marzban outage retries
		 * this job with a backoff up to an hour; a redemption written on the way in would spend a use
		 * of the code on every attempt — and on a `maxUses` code, hand the buyer an overspend alert
		 * for access they never received.
		 */
		const promo = addPromo(db);
		const order = payFor(30, clock.now(), promo.id);
		marzban.failNext(500);

		await expect(handler.handle({ orderId: order.id })).rejects.toBeInstanceOf(MarzbanError);

		expect(db.select().from(promoRedemptions).all()).toEqual([]);
		expect(promoRow(promo.id).usedCount).toBe(0);

		// The retry grants access and spends the code exactly once.
		await handler.handle({ orderId: order.id });

		expect(db.select().from(promoRedemptions).all()).toHaveLength(1);
		expect(promoRow(promo.id).usedCount).toBe(1);
	});

	it('refuses to provision an order nobody paid for', async () => {
		const snapshot = {
			name: '30 дней',
			durationDays: 30,
			priceMinor: 499,
			currency: 'usd' as const,
			trafficLimitBytes: 0
		};
		const unpaid = orders.create({
			userId: user.id,
			planId: plan.id,
			plan: snapshot,
			quote: new PriceCalculator().quote(snapshot, null),
			provider: 'fake'
		});

		// The webhook enqueues inside the transaction that marks the order paid, so this payload can
		// only come from a hand-written job — and it must not buy anybody a free subscription.
		await expect(handler.handle({ orderId: unpaid.id })).rejects.toThrow(/not paid/);
		expect(subscriptionRow()).toBeNull();
	});

	it('spends the promo code exactly once, however often the job runs', async () => {
		/**
		 * tech.md 6 makes redeeming an effect of THIS job, and tech.md 6 also says two runs of a
		 * handler leave one effect. Both at once: a retry after a Marzban timeout must not burn a
		 * second use of the code.
		 */
		const promo = addPromo(db);
		const order = payFor(30, clock.now(), promo.id);

		await handler.handle({ orderId: order.id });
		await handler.handle({ orderId: order.id });

		expect(db.select().from(promoRedemptions).all()).toHaveLength(1);
		expect(promoRow(promo.id).usedCount).toBe(1);
	});

	it('grants access and tells the admin when the code ran out before the payment landed', async () => {
		/**
		 * Somebody else took the last use while this person was on the payment page. The money is
		 * already taken, so refusing the subscription over a discount the shop itself quoted would be
		 * the worse failure — access goes out, the counter stays honest, and the admin hears about it.
		 */
		const promo = addPromo(db, { maxUses: 1, usedCount: 1 });
		const order = payFor(30, clock.now(), promo.id);

		await handler.handle({ orderId: order.id });

		expect(subscriptionRow()).not.toBeNull();
		expect(db.select().from(promoRedemptions).all()).toEqual([]);
		expect(promoRow(promo.id).usedCount).toBe(1);
		expect(messages().some((job) => job.idempotencyKey === `tg:promo:overspent:${order.id}`)).toBe(
			true
		);
	});

	it('leaves the promo tables alone for an order that carried no code', async () => {
		const order = payFor(30);

		await handler.handle({ orderId: order.id });

		expect(db.select().from(promoRedemptions).all()).toEqual([]);
	});

	it('refuses an order that is gone', async () => {
		await expect(handler.handle({ orderId: 4242 })).rejects.toThrow(/gone/);
	});
});
