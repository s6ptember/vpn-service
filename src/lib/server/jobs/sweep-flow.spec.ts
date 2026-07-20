import { beforeEach, describe, expect, it } from 'vitest';
import { UserService } from '$lib/server/auth/user-service';
import { addPlan, addUser } from '$lib/server/billing/fixtures';
import { FakeTelegram } from '$lib/server/clients/telegram';
import type { Db } from '$lib/server/db/client';
import type { UserRow } from '$lib/server/db/schema';
import { PlanService } from '$lib/server/plans';
import { DAY_MS, SubscriptionService } from '$lib/server/subscriptions';
import { createTestDb, silentLogger, TestClock } from './fixtures';
import { SubscriptionNotifyExpiryHandler } from './handlers/subscription-notify-expiry';
import { SubscriptionSweepHandler } from './handlers/subscription-sweep';
import { TelegramSendMessageHandler } from './handlers/telegram-send-message';
import { JobQueue } from './queue';
import { JobScheduler, SWEEP_WINDOW_MS } from './scheduler';
import { JobWorker } from './worker';

/**
 * A15 end to end, across the seam rather than inside one class (tech.md 14 — a contract test at the
 * joint of the slice): the scheduler offers a window, the worker drains it, and a person who is
 * three days from the end of their subscription receives exactly one message about it.
 *
 * The three handlers are wired the way container.ts wires them, so this fails if the real
 * composition drifts — which is the only place the chain sweep -> notice -> message exists at all.
 */

const NOW = 1_784_000_000_000;
const ADMIN_CHAT_ID = 900_000_001;

let db: Db;
let clock: TestClock;
let queue: JobQueue;
let scheduler: JobScheduler;
let worker: JobWorker;
let subscriptions: SubscriptionService;
let telegram: FakeTelegram;
let owner: UserRow;
let planId: number;

/** One turn of the crank: offer the due window, then drain everything it produced. */
async function runSweepCycle(): Promise<void> {
	scheduler.enqueueDue();
	await worker.tick();
}

function addSubscription(expiresAtMs: number): number {
	return subscriptions.upsert({
		userId: owner.id,
		planId,
		marzbanUsername: `tg_${owner.telegramId}`,
		subscriptionUrl: `https://sub.local/sub/tg_${owner.telegramId}`,
		startsAtMs: NOW - 30 * DAY_MS,
		expiresAtMs,
		status: 'active'
	}).id;
}

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock(NOW);
	queue = new JobQueue(db, clock.now);
	subscriptions = new SubscriptionService(db, { now: clock.now });
	telegram = new FakeTelegram();
	owner = addUser(db);
	planId = addPlan(db, { name: '30 дней' }).id;

	scheduler = new JobScheduler(queue, { now: clock.now });
	worker = new JobWorker(
		queue,
		[
			new SubscriptionSweepHandler(subscriptions, queue, silentLogger(), { now: clock.now }),
			new SubscriptionNotifyExpiryHandler(
				subscriptions,
				new UserService(db),
				new PlanService(db, 'usd'),
				queue,
				silentLogger(),
				{ now: clock.now }
			),
			new TelegramSendMessageHandler(telegram, silentLogger())
		],
		silentLogger(),
		{ adminChatId: ADMIN_CHAT_ID }
	);
});

describe('the sweep, end to end', () => {
	/**
	 * One tick drains the whole cascade: the sweep enqueues the notice, which is due at once, and the
	 * notice enqueues the message, which is too. That is what MAX_JOBS_PER_TICK buys — a person is
	 * told inside one tick rather than three.
	 */
	it('warns the owner three days out, in one drain', async () => {
		addSubscription(NOW + 3 * DAY_MS);

		await runSweepCycle();

		expect(telegram.sent).toHaveLength(1);
		expect(telegram.sent[0].chatId).toBe(owner.telegramId);
		expect(telegram.sent[0].text).toContain('через 3 дня');
	});

	/** The scheduler runs far more often than the window; the extra turns must cost nothing. */
	it('says nothing more however many times the cycle turns inside one window', async () => {
		addSubscription(NOW + 3 * DAY_MS);

		await runSweepCycle();
		await runSweepCycle();
		await runSweepCycle();

		expect(telegram.sent).toHaveLength(1);
	});

	/**
	 * The whole life of one subscription: warned at three days, warned again at one, and closed when
	 * the term runs out — three distinct effects and not one repeat between them.
	 */
	it('walks a subscription from its first warning to expiry', async () => {
		const id = addSubscription(NOW + 3 * DAY_MS);

		await runSweepCycle();
		expect(telegram.sent).toHaveLength(1);

		// Two days on: past the 3-day mark, at the 1-day mark.
		clock.advance(2 * DAY_MS);
		await runSweepCycle();

		expect(telegram.sent).toHaveLength(2);
		expect(telegram.sent[1].text).toContain('через 1 день');
		expect(subscriptions.findById(id)?.status).toBe('active');

		// And past the end.
		clock.advance(2 * DAY_MS);
		await runSweepCycle();

		expect(subscriptions.findById(id)?.status).toBe('expired');
		// Nothing is said about a subscription that has already ended.
		expect(telegram.sent).toHaveLength(2);
	});

	/**
	 * The window key is the only thing standing between a restarting container and a flood, so it is
	 * worth one test at this level too: a fresh scheduler and a fresh worker over the same database.
	 */
	it('repeats nothing when the process restarts inside a window', async () => {
		addSubscription(NOW + 3 * DAY_MS);
		await runSweepCycle();

		clock.advance(SWEEP_WINDOW_MS - (NOW % SWEEP_WINDOW_MS) - 1);
		const restarted = new JobScheduler(queue, { now: clock.now });
		restarted.enqueueDue();
		await worker.tick();

		expect(telegram.sent).toHaveLength(1);
	});

	it('leaves nothing failed behind it', async () => {
		addSubscription(NOW + 3 * DAY_MS);

		await runSweepCycle();

		expect(queue.findRunning()).toEqual([]);
		// A failed job would have queued an admin alert; the only message is the one to the owner.
		expect(telegram.sent.map((message) => message.chatId)).toEqual([owner.telegramId]);
	});
});
