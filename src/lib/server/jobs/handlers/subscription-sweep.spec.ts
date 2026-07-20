import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { addPlan, addUser } from '$lib/server/billing/fixtures';
import type { Db } from '$lib/server/db/client';
import { jobs, type JobRow } from '$lib/server/db/schema';
import { DAY_MS, SubscriptionService } from '$lib/server/subscriptions';
import { createTestDb, silentLogger, TestClock } from '../fixtures';
import { JobQueue } from '../queue';
import { JobWorker } from '../worker';
import { SubscriptionSweepHandler } from './subscription-sweep';

/**
 * A15's acceptance criteria (tech.md 6 and 16): the sweep marks lapsed subscriptions `expired` and
 * schedules a warning at three days left and at one day left — and at nothing else.
 *
 * The marks and the key format are transcribed from tech.md 6, not read back out of the handler.
 */

const NOW = 1_784_000_000_000;
const ADMIN_CHAT_ID = 900_000_001;

let db: Db;
let clock: TestClock;
let queue: JobQueue;
let subscriptions: SubscriptionService;
let handler: SubscriptionSweepHandler;
let planId: number;
let nextTelegramId = 700_200_000;

function addSubscription(
	expiresAtMs: number,
	status: 'active' | 'expired' | 'revoked' = 'active'
): number {
	const user = addUser(db, { telegramId: (nextTelegramId += 1) });

	return subscriptions.upsert({
		userId: user.id,
		planId,
		marzbanUsername: `tg_${user.telegramId}`,
		subscriptionUrl: `https://sub.local/sub/tg_${user.telegramId}`,
		startsAtMs: NOW - 30 * DAY_MS,
		expiresAtMs,
		status
	}).id;
}

const warnings = (): JobRow[] =>
	db
		.select()
		.from(jobs)
		.where(eq(jobs.type, 'subscription.notify_expiry'))
		.orderBy(asc(jobs.id))
		.all();

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock(NOW);
	queue = new JobQueue(db, clock.now);
	subscriptions = new SubscriptionService(db, { now: clock.now });
	planId = addPlan(db).id;

	handler = new SubscriptionSweepHandler(subscriptions, queue, silentLogger(), { now: clock.now });
});

describe('SubscriptionSweepHandler', () => {
	it('marks a subscription whose term ran out as expired', async () => {
		const id = addSubscription(NOW - DAY_MS);

		await handler.handle();

		expect(subscriptions.findById(id)?.status).toBe('expired');
	});

	it('leaves a subscription that is still running alone', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);

		await handler.handle();

		expect(subscriptions.findById(id)?.status).toBe('active');
		expect(warnings()).toEqual([]);
	});

	// --- the two marks (tech.md 6) ----------------------------------------------------------------

	it('schedules the warning three days out, keyed by the subscription and the mark', async () => {
		const id = addSubscription(NOW + 3 * DAY_MS);

		await handler.handle();

		expect(warnings()).toHaveLength(1);
		expect(warnings()[0].payload).toEqual({ subscriptionId: id, daysLeft: 3 });
		expect(warnings()[0].idempotencyKey).toBe(`expiry:${id}:${NOW + 3 * DAY_MS}:3`);
	});

	it('schedules the warning one day out', async () => {
		const id = addSubscription(NOW + DAY_MS);

		await handler.handle();

		expect(warnings()).toHaveLength(1);
		expect(warnings()[0].payload).toEqual({ subscriptionId: id, daysLeft: 1 });
		expect(warnings()[0].idempotencyKey).toBe(`expiry:${id}:${NOW + DAY_MS}:1`);
	});

	/**
	 * The marks are the contract, not "warn while it is nearly over". A sweep on the day between
	 * them has nobody to warn, and a subscription four days out is outside the lookahead entirely.
	 */
	it.each([2, 4])('warns nobody with %i days left', async (days) => {
		addSubscription(NOW + days * DAY_MS);

		await handler.handle();

		expect(warnings()).toEqual([]);
	});

	/**
	 * `daysLeft` rounds up, so a subscription with eleven hours to run still has "1 день" — and the
	 * warning has to go out on that sweep rather than never. The same rounding the profile screen
	 * uses, from the one shared implementation (CLAUDE.md 4).
	 */
	it('counts a part-day as a whole one, so a subscription is never skipped past its mark', async () => {
		const id = addSubscription(NOW + DAY_MS - 3_600_000);

		await handler.handle();

		expect(warnings()[0].payload).toEqual({ subscriptionId: id, daysLeft: 1 });
	});

	it('warns nobody about a subscription that has already lapsed', async () => {
		addSubscription(NOW - 1);

		await handler.handle();

		expect(warnings()).toEqual([]);
	});

	it('never touches a revoked subscription', async () => {
		const id = addSubscription(NOW - DAY_MS, 'revoked');

		await handler.handle();

		expect(subscriptions.findById(id)?.status).toBe('revoked');
	});

	it('handles a whole batch in one run', async () => {
		const lapsed = addSubscription(NOW - DAY_MS);
		const threeDays = addSubscription(NOW + 3 * DAY_MS);
		const oneDay = addSubscription(NOW + DAY_MS);

		await handler.handle();

		expect(subscriptions.findById(lapsed)?.status).toBe('expired');
		expect(
			warnings()
				.map((row) => row.idempotencyKey)
				.sort()
		).toEqual(
			[`expiry:${threeDays}:${NOW + 3 * DAY_MS}:3`, `expiry:${oneDay}:${NOW + DAY_MS}:1`].sort()
		);
	});

	// --- idempotency (tech.md 6) ------------------------------------------------------------------

	it('leaves one warning and one status write however many times it runs', async () => {
		const id = addSubscription(NOW + 3 * DAY_MS);
		addSubscription(NOW - DAY_MS);

		await handler.handle();
		await handler.handle();
		await handler.handle();

		expect(warnings()).toHaveLength(1);
		expect(warnings()[0].idempotencyKey).toBe(`expiry:${id}:${NOW + 3 * DAY_MS}:3`);
	});

	/**
	 * The path that makes convergence necessary rather than theoretical: a process died mid-job, the
	 * row is still `running`, and the worker re-runs it on the next start (jobs/worker.ts).
	 */
	it('survives a worker that restarts on top of a sweep it already finished', async () => {
		const id = addSubscription(NOW + 3 * DAY_MS);
		queue.enqueue('subscription.sweep', {}, 'sweep:1');

		const claimed = queue.claim()!;
		expect(claimed.type).toBe('subscription.sweep');

		// Left `running` by the process that died. recoverOrphans fails it back to pending...
		const worker = new JobWorker(queue, [handler], silentLogger(), { adminChatId: ADMIN_CHAT_ID });
		worker.start();
		worker.stop();

		clock.advance(60 * 60_000);
		await worker.tick();

		expect(queue.find(claimed.id)?.status).toBe('done');
		// Still one, even though the sweep ran a second time an hour later — and the mark held,
		// because the subscription is now two days out and the 3-day key is already spent.
		expect(warnings()).toHaveLength(1);
		expect(warnings()[0].idempotencyKey).toBe(`expiry:${id}:${NOW + 3 * DAY_MS}:3`);
	});

	/**
	 * The regression tech.md 6 gained its `expiresAtMs` component for (core v3).
	 *
	 * A subscription keeps its id across renewals and nothing purges the jobs table, so a key built
	 * from the id alone is spent by the first term and silently drops every warning the person is
	 * owed afterwards — for the rest of their life, not for one cycle. Two terms must produce four
	 * warnings.
	 */
	it('warns the renewed term too, on its own keys', async () => {
		const id = addSubscription(NOW + 3 * DAY_MS);
		const firstTermEnd = NOW + 3 * DAY_MS;

		await handler.handle();
		clock.advance(2 * DAY_MS);
		await handler.handle();
		expect(warnings()).toHaveLength(2);

		// The person renews for another 30 days. The row keeps its id; only the date moves.
		const renewedEnd = clock.now() + 30 * DAY_MS;
		subscriptions.upsert({
			userId: subscriptions.findById(id)!.userId,
			planId,
			marzbanUsername: subscriptions.findById(id)!.marzbanUsername,
			subscriptionUrl: subscriptions.findById(id)!.subscriptionUrl,
			startsAtMs: NOW,
			expiresAtMs: renewedEnd,
			status: 'active'
		});

		// Run the new term down to both marks.
		clock.advance(27 * DAY_MS);
		await handler.handle();
		clock.advance(2 * DAY_MS);
		await handler.handle();

		expect(warnings().map((row) => row.idempotencyKey)).toEqual([
			`expiry:${id}:${firstTermEnd}:3`,
			`expiry:${id}:${firstTermEnd}:1`,
			`expiry:${id}:${renewedEnd}:3`,
			`expiry:${id}:${renewedEnd}:1`
		]);
	});

	/**
	 * The second sweep of a subscription's life reaches its second mark, and that one is a different
	 * key — so it is scheduled, and the first is not scheduled again.
	 */
	it('warns again at the next mark as the subscription runs down', async () => {
		const id = addSubscription(NOW + 3 * DAY_MS);

		await handler.handle();
		clock.advance(2 * DAY_MS);
		await handler.handle();

		expect(warnings().map((row) => row.idempotencyKey)).toEqual([
			`expiry:${id}:${NOW + 3 * DAY_MS}:3`,
			`expiry:${id}:${NOW + 3 * DAY_MS}:1`
		]);
	});
});
