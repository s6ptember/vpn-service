import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { UserService } from '$lib/server/auth/user-service';
import { addPlan, addUser } from '$lib/server/billing/fixtures';
import { FakeTelegram } from '$lib/server/clients/telegram';
import type { Db } from '$lib/server/db/client';
import { jobs, type JobRow, type UserRow } from '$lib/server/db/schema';
import { PlanService } from '$lib/server/plans';
import { DAY_MS, SubscriptionService } from '$lib/server/subscriptions';
import { createTestDb, silentLogger, TestClock } from '../fixtures';
import { JobQueue } from '../queue';
import { JobWorker } from '../worker';
import { SubscriptionNotifyExpiryHandler } from './subscription-notify-expiry';
import { TelegramSendMessageHandler } from './telegram-send-message';

/**
 * A15's second criterion (tech.md 6): "одно сообщение о скором окончании". One, however many times
 * the job runs — and none at all when the fact it was scheduled on has since stopped being true.
 */

const NOW = 1_784_000_000_000;
const ADMIN_CHAT_ID = 900_000_001;

let db: Db;
let clock: TestClock;
let queue: JobQueue;
let subscriptions: SubscriptionService;
let handler: SubscriptionNotifyExpiryHandler;
let owner: UserRow;
let planId: number;

function addSubscription(
	expiresAtMs: number,
	status: 'active' | 'expired' | 'revoked' = 'active'
): number {
	return subscriptions.upsert({
		userId: owner.id,
		planId,
		marzbanUsername: `tg_${owner.telegramId}`,
		subscriptionUrl: `https://sub.local/sub/tg_${owner.telegramId}`,
		startsAtMs: NOW - 30 * DAY_MS,
		expiresAtMs,
		status
	}).id;
}

/** What the person actually receives is a row in the queue, so that is what the tests read. */
const messages = (): JobRow[] =>
	db.select().from(jobs).where(eq(jobs.type, 'telegram.send_message')).orderBy(asc(jobs.id)).all();

const payloadOf = (row: JobRow) =>
	row.payload as { chatId: number; text: string; dedupeKey: string };

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock(NOW);
	queue = new JobQueue(db, clock.now);
	subscriptions = new SubscriptionService(db, { now: clock.now });
	owner = addUser(db);
	planId = addPlan(db, { name: '30 дней' }).id;

	handler = new SubscriptionNotifyExpiryHandler(
		subscriptions,
		new UserService(db),
		new PlanService(db, 'usd'),
		queue,
		silentLogger(),
		{ now: clock.now }
	);
});

describe('SubscriptionNotifyExpiryHandler', () => {
	it('addresses the warning to the owner and names the plan, the days and the date', async () => {
		const id = addSubscription(NOW + 3 * DAY_MS);

		await handler.handle({ subscriptionId: id, daysLeft: 3 });

		expect(messages()).toHaveLength(1);
		const sent = payloadOf(messages()[0]);
		expect(sent.chatId).toBe(owner.telegramId);
		expect(sent.text).toContain('30 дней');
		expect(sent.text).toContain('через 3 дня');
	});

	/** Russian makes the noun agree with the number; one mark says "дня", the other says "день". */
	it('writes the day word to match the number', async () => {
		const id = addSubscription(NOW + DAY_MS);

		await handler.handle({ subscriptionId: id, daysLeft: 1 });

		expect(payloadOf(messages()[0]).text).toContain('через 1 день');
	});

	/**
	 * The sentence is read by a person, so it has to read like one. ru-RU renders a year as
	 * «17 июля 2026 г.» — a trailing period that lands next to the one closing the clause and comes
	 * out as «2026 г...». The date is at most three days away, so the year is dropped instead.
	 */
	it('names the date without a year and punctuates the sentence once', async () => {
		const id = addSubscription(NOW + 3 * DAY_MS);

		await handler.handle({ subscriptionId: id, daysLeft: 3 });

		const { text } = payloadOf(messages()[0]);
		expect(text).not.toMatch(/\.\./);
		expect(text).not.toContain('г.');
		expect(text).toMatch(/через 3 дня, \d{1,2} \p{Script=Cyrillic}+\./u);
	});

	it('keys the message so the queue can refuse a duplicate', async () => {
		const id = addSubscription(NOW + 3 * DAY_MS);

		await handler.handle({ subscriptionId: id, daysLeft: 3 });

		expect(payloadOf(messages()[0]).dedupeKey).toBe(`expiry:${id}:3`);
		expect(messages()[0].idempotencyKey).toBe(`tg:expiry:${id}:3`);
	});

	// --- idempotency (tech.md 6) ------------------------------------------------------------------

	it('sends one message however many times it runs', async () => {
		const id = addSubscription(NOW + 3 * DAY_MS);

		await handler.handle({ subscriptionId: id, daysLeft: 3 });
		await handler.handle({ subscriptionId: id, daysLeft: 3 });
		await handler.handle({ subscriptionId: id, daysLeft: 3 });

		expect(messages()).toHaveLength(1);
	});

	/**
	 * The path that makes the key necessary rather than theoretical: a process died mid-job, the row
	 * is still `running`, and the worker re-runs it on the next start (jobs/worker.ts).
	 */
	it('survives a worker that restarts on top of a job it already finished', async () => {
		const id = addSubscription(NOW + 3 * DAY_MS);
		queue.enqueue(
			'subscription.notify_expiry',
			{ subscriptionId: id, daysLeft: 3 },
			`expiry:${id}:3`
		);
		await handler.handle({ subscriptionId: id, daysLeft: 3 });

		const claimed = queue.claim()!;
		expect(claimed.type).toBe('subscription.notify_expiry');

		/**
		 * The send handler is registered too, because the tick drains every due job rather than the
		 * one under test — and with the queue standing in for the outbox here, a worker that could
		 * not run `telegram.send_message` would fail the queued message as an unknown type and the
		 * resulting admin alert would look exactly like a second notification.
		 */
		const telegram = new FakeTelegram();
		// Left `running` by the process that died. recoverOrphans fails it back to pending...
		const worker = new JobWorker(
			queue,
			[handler, new TelegramSendMessageHandler(telegram, silentLogger())],
			silentLogger(),
			{ adminChatId: ADMIN_CHAT_ID }
		);
		worker.start();
		worker.stop();

		// ...behind the retry backoff, so the re-run only becomes due once that has elapsed.
		clock.advance(60 * 60_000);
		await worker.tick();

		// The re-run really happened — the job is finished, not merely left where it was.
		expect(queue.find(claimed.id)?.status).toBe('done');
		expect(messages()).toHaveLength(1);
		// And the person was told once, all the way through to the client.
		expect(telegram.sent).toHaveLength(1);
	});

	// --- the fact stopped being true (tech.md 6) --------------------------------------------------

	/**
	 * The case the recheck exists for. A retry backs off up to an hour, and in that hour the person
	 * may have renewed — telling somebody who just bought 90 days that they have 1 left is worse
	 * than saying nothing.
	 */
	it('says nothing when the subscription was renewed between the sweep and the run', async () => {
		const id = addSubscription(NOW + DAY_MS);

		subscriptions.upsert({
			userId: owner.id,
			planId,
			marzbanUsername: `tg_${owner.telegramId}`,
			subscriptionUrl: `https://sub.local/sub/tg_${owner.telegramId}`,
			startsAtMs: NOW - 30 * DAY_MS,
			expiresAtMs: NOW + 90 * DAY_MS,
			status: 'active'
		});

		await handler.handle({ subscriptionId: id, daysLeft: 1 });

		expect(messages()).toEqual([]);
	});

	it('says nothing about a revoked subscription', async () => {
		const id = addSubscription(NOW + DAY_MS, 'revoked');

		await handler.handle({ subscriptionId: id, daysLeft: 1 });

		expect(messages()).toEqual([]);
	});

	it('says nothing about a subscription that already lapsed while the job waited', async () => {
		const id = addSubscription(NOW + DAY_MS);
		clock.advance(2 * DAY_MS);

		await handler.handle({ subscriptionId: id, daysLeft: 1 });

		expect(messages()).toEqual([]);
	});

	it('throws on a subscription that does not exist rather than reporting success', async () => {
		await expect(handler.handle({ subscriptionId: 4242, daysLeft: 3 })).rejects.toThrow(/4242/);
		expect(messages()).toEqual([]);
	});
});
