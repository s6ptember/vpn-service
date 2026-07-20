import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '$lib/server/db/client';
import { jobs, type JobRow } from '$lib/server/db/schema';
import { createTestDb, TestClock } from './fixtures';
import { JobQueue } from './queue';
import { JobScheduler, SWEEP_WINDOW_MS } from './scheduler';

/**
 * A15's scheduling criterion, straight from tech.md 6: the sweep is offered once per five-minute
 * window, and "рестарт контейнера внутри окна дубля не создаст".
 *
 * The expected keys are transcribed from that line rather than read back out of the scheduler — a
 * test that asked the code what key it writes would agree with any key at all.
 */

/** Chosen so NOW is not itself a window boundary: an offset start is the harder case. */
const NOW = 1_784_000_123_456;

/**
 * How long the window NOW falls in still has to run. Derived rather than written down as a constant
 * — NOW sits partway through a window, so "advance by almost a whole window" would step over the
 * boundary and the test would be asserting the opposite of what it says.
 */
const REMAINING_IN_WINDOW = SWEEP_WINDOW_MS - (NOW % SWEEP_WINDOW_MS);

let db: Db;
let clock: TestClock;
let queue: JobQueue;
let scheduler: JobScheduler;

const sweeps = (): JobRow[] =>
	db.select().from(jobs).where(eq(jobs.type, 'subscription.sweep')).orderBy(asc(jobs.id)).all();

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock(NOW);
	queue = new JobQueue(db, clock.now);
	scheduler = new JobScheduler(queue, { now: clock.now });
});

describe('JobScheduler', () => {
	it('offers the sweep keyed by the five-minute window it belongs to', () => {
		scheduler.enqueueDue();

		expect(sweeps()).toHaveLength(1);
		expect(sweeps()[0].idempotencyKey).toBe(`sweep:${Math.floor(NOW / 300_000)}`);
		expect(sweeps()[0].payload).toEqual({});
	});

	it('adds nothing on a second tick inside the same window', () => {
		scheduler.enqueueDue();
		clock.advance(REMAINING_IN_WINDOW - 1);
		scheduler.enqueueDue();

		expect(sweeps()).toHaveLength(1);
	});

	it('offers exactly one more once the window has turned over', () => {
		scheduler.enqueueDue();
		clock.advance(REMAINING_IN_WINDOW);
		scheduler.enqueueDue();

		expect(sweeps()).toHaveLength(2);
	});

	/**
	 * The restart tech.md 6 names. A fresh scheduler over the same queue recomputes the window from
	 * the clock, so it lands on the key that is already there — a deploy loop cannot flood the queue.
	 */
	it('creates no duplicate when the process restarts inside a window', () => {
		scheduler.start();
		scheduler.stop();

		clock.advance(REMAINING_IN_WINDOW - 1);
		const restarted = new JobScheduler(queue, { now: clock.now });
		restarted.start();
		restarted.stop();

		expect(sweeps()).toHaveLength(1);
	});

	/** A just-deployed container must not sweep nothing until the first interval elapses. */
	it('offers the current window as soon as it starts', () => {
		scheduler.start();
		scheduler.stop();

		expect(sweeps()).toHaveLength(1);
	});

	it('leaves one timer behind however many times it is started', () => {
		scheduler.start();
		scheduler.start();
		scheduler.stop();

		// Two live timers would show up as a second offer the moment the window turned over.
		clock.advance(REMAINING_IN_WINDOW);
		scheduler.enqueueDue();

		expect(sweeps()).toHaveLength(2);
	});
});
