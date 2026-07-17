import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db/client';
import { jobs } from '$lib/server/db/schema';
import { createTestDb, TestClock } from './fixtures';
import { JobQueue } from './queue';

const CHAT_ID = 42;

function message(dedupeKey: string) {
	return { chatId: CHAT_ID, text: 'Подписка активна', dedupeKey };
}

describe('JobQueue', () => {
	let db: Db;
	let clock: TestClock;
	let queue: JobQueue;

	beforeEach(() => {
		db = createTestDb();
		clock = new TestClock();
		queue = new JobQueue(db, clock.now);
	});

	const rows = () => db.select().from(jobs).all();
	const row = (id: number) => db.select().from(jobs).where(eq(jobs.id, id)).get();

	describe('enqueue', () => {
		it('inserts exactly one row for a duplicate idempotency key and does not throw', () => {
			// tech.md 6: a duplicate insert loses on the unique index and silently counts as success.
			// This is the barrier that stops a redelivered webhook granting a second subscription.
			queue.enqueue('telegram.send_message', message('welcome:7'), 'tg:welcome:7');

			expect(() =>
				queue.enqueue('telegram.send_message', message('welcome:7'), 'tg:welcome:7')
			).not.toThrow();

			expect(rows()).toHaveLength(1);
		});

		it('stores the job pending and due now', () => {
			queue.enqueue('telegram.send_message', message('welcome:7'), 'tg:welcome:7');

			expect(rows()[0]).toMatchObject({
				type: 'telegram.send_message',
				status: 'pending',
				attempts: 0,
				maxAttempts: 5,
				runAt: new Date(clock.now()),
				lastError: null,
				lockedAt: null
			});
		});

		it('keeps the first payload when a duplicate key arrives with different content', () => {
			queue.enqueue('telegram.send_message', message('welcome:7'), 'tg:welcome:7');
			queue.enqueue(
				'telegram.send_message',
				{ chatId: 999, text: 'Другой текст', dedupeKey: 'welcome:7' },
				'tg:welcome:7'
			);

			expect(rows()[0].payload).toMatchObject({ chatId: CHAT_ID });
		});

		it('honours runAt so a job can be scheduled into the future', () => {
			const runAt = clock.now() + 60_000;
			queue.enqueue('subscription.sweep', {}, 'sweep:1', { runAt });

			expect(rows()[0].runAt).toEqual(new Date(runAt));
			expect(queue.claim()).toBeNull();
		});
	});

	describe('claim', () => {
		it('flips pending to running and stamps the attempt', () => {
			queue.enqueue('telegram.send_message', message('welcome:7'), 'tg:welcome:7');

			const claimed = queue.claim();

			expect(claimed).toMatchObject({
				status: 'running',
				attempts: 1,
				lockedAt: new Date(clock.now())
			});
		});

		it('hands each row to exactly one caller and then runs dry', () => {
			queue.enqueue('telegram.send_message', message('a'), 'tg:a');
			queue.enqueue('telegram.send_message', message('b'), 'tg:b');
			queue.enqueue('telegram.send_message', message('c'), 'tg:c');

			// Honest scope: better-sqlite3 is synchronous, so these calls interleave no more than any
			// other statement in this thread. What is verified is the pending -> running flip that
			// keeps a claimed row out of the next SELECT. The BEGIN IMMEDIATE that tech.md 6 requires
			// only pays off under genuine cross-process contention and no in-process test can observe
			// it — swapping it for a deferred transaction leaves this suite green. See the review note.
			const other = new JobQueue(db, clock.now);

			const claimed = [queue.claim(), other.claim(), queue.claim(), other.claim()];
			const ids = claimed.map((job) => job?.id);

			expect(ids.slice(0, 3)).toEqual([1, 2, 3]);
			expect(new Set(ids.slice(0, 3)).size).toBe(3);
			expect(claimed[3]).toBeNull();
		});

		it('leaves a job that is not due yet alone', () => {
			queue.enqueue('telegram.send_message', message('later'), 'tg:later', {
				runAt: clock.now() + 30_000
			});

			expect(queue.claim()).toBeNull();

			clock.advance(30_000);

			expect(queue.claim()).not.toBeNull();
		});

		it('takes the oldest due job first', () => {
			queue.enqueue('telegram.send_message', message('later'), 'tg:later', {
				runAt: clock.now() + 10_000
			});
			queue.enqueue('telegram.send_message', message('now'), 'tg:now');

			clock.advance(10_000);

			expect(queue.claim()).toMatchObject({ idempotencyKey: 'tg:now' });
		});
	});

	describe('complete', () => {
		it('marks the job done and clears the lock and the stale error of an earlier attempt', () => {
			queue.enqueue('telegram.send_message', message('welcome:7'), 'tg:welcome:7');
			const id = queue.claim()!.id;
			queue.fail(id, new Error('temporary'));

			clock.advance(60_000);
			queue.claim();
			queue.complete(id);

			expect(row(id)).toMatchObject({ status: 'done', lockedAt: null, lastError: null });
		});
	});

	describe('fail', () => {
		it('retries with the tech.md 6 backoff: 2^attempts * 30s, capped at 1h', () => {
			// The expected delays are transcribed from tech.md 6, not read back from the queue.
			const expected = [60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000];

			queue.enqueue('telegram.send_message', message('retry'), 'tg:retry', { maxAttempts: 12 });

			expected.forEach((delay, index) => {
				const claimed = queue.claim();
				expect(claimed).toMatchObject({ attempts: index + 1 });

				const failedAt = clock.now();
				queue.fail(claimed!.id, new Error('boom'));

				expect(row(claimed!.id)).toMatchObject({
					status: 'pending',
					attempts: index + 1,
					lockedAt: null,
					runAt: new Date(failedAt + delay)
				});

				clock.advance(delay);
			});
		});

		it('caps the wait at one hour once the doubling passes it', () => {
			// 2^7 * 30s = 3840s, which is over the 1h ceiling; the eighth wait must not grow further.
			queue.enqueue('telegram.send_message', message('cap'), 'tg:cap', { maxAttempts: 12 });

			for (let i = 0; i < 8; i++) {
				const claimed = queue.claim()!;
				queue.fail(claimed.id, new Error('boom'));
				clock.advance(3_600_000);
			}

			const claimed = queue.claim()!;
			const failedAt = clock.now();
			queue.fail(claimed.id, new Error('boom'));

			expect(row(claimed.id)).toMatchObject({ runAt: new Date(failedAt + 3_600_000) });
		});

		it('goes terminal with lastError once attempts reach maxAttempts', () => {
			queue.enqueue('telegram.send_message', message('doomed'), 'tg:doomed', { maxAttempts: 2 });

			queue.fail(queue.claim()!.id, new Error('first'));
			expect(row(1)).toMatchObject({ status: 'pending', attempts: 1 });

			clock.advance(60_000);
			queue.fail(queue.claim()!.id, new Error('second'));

			expect(row(1)).toMatchObject({
				status: 'failed',
				attempts: 2,
				lockedAt: null,
				lastError: 'Error: second'
			});
		});

		it('goes terminal at once when told to', () => {
			queue.enqueue('telegram.send_message', message('bad'), 'tg:bad', { maxAttempts: 5 });
			const id = queue.claim()!.id;

			queue.fail(id, new Error('unknown job type: nope'), { terminal: true });

			// Terminal on the first attempt: retrying an unfixable job only delays the admin alert.
			expect(row(id)).toMatchObject({ status: 'failed', attempts: 1 });
		});

		it('redacts and truncates lastError instead of storing a raw throw', () => {
			queue.enqueue('telegram.send_message', message('secret'), 'tg:secret', { maxAttempts: 1 });
			const id = queue.claim()!.id;

			queue.fail(
				id,
				new Error(
					`bot rejected token 123456789:AAHfakeTokenValueThatIsLongEnough12345 ${'x'.repeat(900)}`
				)
			);

			const lastError = row(id)!.lastError!;
			expect(lastError).not.toContain('AAHfakeTokenValueThatIsLongEnough12345');
			expect(lastError).toContain('[redacted]');
			expect(lastError.length).toBeLessThanOrEqual(500);
		});
	});
});
