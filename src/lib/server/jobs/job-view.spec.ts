import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '$lib/server/db/client';
import { createTestDb, TestClock } from './fixtures';
import { toFailedJobView } from './job-view';
import { JobQueue } from './queue';

/**
 * A16's failed-jobs list. Two criteria, and the second is the one worth a test: the newest failure
 * is on top, and nothing that belongs in a log line escapes onto a rendered page.
 */

const NOW = 1_784_000_000_000;

let db: Db;
let clock: TestClock;
let queue: JobQueue;

/** Burns a job's attempts the way the worker does, until the queue calls it terminal. */
function failTerminally(key: string, error: string): number {
	queue.enqueue('telegram.send_message', { chatId: 1, text: 'x', dedupeKey: key }, `tg:${key}`);

	const claimed = queue.claim()!;
	queue.fail(claimed.id, new Error(error), { terminal: true });
	return claimed.id;
}

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock(NOW);
	queue = new JobQueue(db, clock.now);
});

describe('JobQueue.listFailed', () => {
	it('lists only jobs that ran out of attempts', () => {
		failTerminally('failed-one', 'boom');
		queue.enqueue('telegram.send_message', { chatId: 1, text: 'x', dedupeKey: 'ok' }, 'tg:ok');

		const failed = queue.listFailed();

		expect(failed).toHaveLength(1);
		expect(failed[0].status).toBe('failed');
	});

	it('puts the most recent failure first', () => {
		const first = failTerminally('one', 'boom');
		clock.advance(60_000);
		const second = failTerminally('two', 'boom');

		expect(queue.listFailed().map((row) => row.id)).toEqual([second, first]);
	});

	it('stops at the limit rather than rendering a week of failures', () => {
		for (let i = 0; i < 5; i++) {
			clock.advance(1_000);
			failTerminally(`key-${i}`, 'boom');
		}

		expect(queue.listFailed(3)).toHaveLength(3);
	});

	it('answers empty when nothing has failed', () => {
		expect(queue.listFailed()).toEqual([]);
	});
});

describe('toFailedJobView', () => {
	it('carries what an admin needs to decide what to do next', () => {
		const id = failTerminally('one', 'marzban answered 500');

		const view = toFailedJobView(queue.find(id)!);

		expect(view).toEqual({
			id,
			type: 'telegram.send_message',
			attempts: 1,
			maxAttempts: 5,
			lastError: expect.stringContaining('marzban answered 500'),
			updatedAt: NOW
		});
	});

	/**
	 * The payload is the one field on the row carrying domain data — a chat id, somebody's message,
	 * an order. `log.ts` masks `payload` before it can reach stdout, and a page an admin screenshots
	 * is not a safer place for it than a log line.
	 */
	it('does not carry the payload onto the screen', () => {
		const id = failTerminally('one', 'boom');

		expect(toFailedJobView(queue.find(id)!)).not.toHaveProperty('payload');
	});

	it('hands dates over as milliseconds, like every other view in this codebase', () => {
		const id = failTerminally('one', 'boom');

		expect(typeof toFailedJobView(queue.find(id)!).updatedAt).toBe('number');
	});
});
