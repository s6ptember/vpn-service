import { and, asc, desc, eq, lte } from 'drizzle-orm';
import type { JobMap, JobType } from '$lib/types';
import type { Db } from '$lib/server/db/client';
import { jobs, type JobRow } from '$lib/server/db/schema';
import { redactText } from '$lib/server/log';

/** tech.md 6: runAt = now + min(2^attempts * 30s, 1h). */
const RETRY_BASE_MS = 30_000;
const RETRY_CAP_MS = 3_600_000;

/** lastError is operator context, not a payload. Bound it so one stack trace cannot bloat the row. */
const LAST_ERROR_MAX_CHARS = 500;

const DEFAULT_MAX_ATTEMPTS = 5;

export interface EnqueueOptions {
	/** Epoch ms. Defaults to now: the job is due immediately. */
	runAt?: number;
	maxAttempts?: number;
}

export interface FailOptions {
	/**
	 * Skip the backoff and go terminal at once. For failures no retry can fix — an unknown job
	 * type, a payload that does not parse — burning five attempts only delays the admin alert.
	 */
	terminal?: boolean;
}

/**
 * The jobs table as a queue (tech.md 6). Every method is synchronous: better-sqlite3 is a sync
 * driver, and pretending otherwise would only hide that claim() holds a write lock.
 */
export class JobQueue {
	constructor(
		private readonly db: Db,
		private readonly now: () => number = Date.now
	) {}

	/**
	 * Payload carries ids and scalars only (tech.md 6). Domain objects would be stale by the time
	 * the worker picks the row up, so the handler re-reads what it needs.
	 *
	 * The idempotency key is mandatory and unique. A duplicate insert loses the race on the unique
	 * index and counts as success: that is what stops a redelivered Stripe webhook from granting a
	 * second subscription.
	 */
	enqueue<T extends JobType>(
		type: T,
		payload: JobMap[T],
		idempotencyKey: string,
		opts?: EnqueueOptions
	): void {
		const now = this.now();

		this.db
			.insert(jobs)
			.values({
				type,
				payload,
				idempotencyKey,
				status: 'pending',
				attempts: 0,
				maxAttempts: opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
				runAt: new Date(opts?.runAt ?? now),
				createdAt: new Date(now),
				updatedAt: new Date(now)
			})
			.onConflictDoNothing({ target: jobs.idempotencyKey })
			.run();
	}

	/**
	 * Takes one due job and flips it pending -> running, stamping the attempt.
	 *
	 * BEGIN IMMEDIATE takes the write lock before the SELECT, so two ticks can never read the same
	 * pending row and both claim it. A deferred transaction would let both read and one lose on
	 * write — with the job already dispatched twice.
	 */
	claim(): JobRow | null {
		const now = this.now();

		return this.db.transaction(
			(tx) => {
				const due = tx
					.select()
					.from(jobs)
					.where(and(eq(jobs.status, 'pending'), lte(jobs.runAt, new Date(now))))
					.orderBy(asc(jobs.runAt), asc(jobs.id))
					.limit(1)
					.get();

				if (!due) return null;

				const claimed = tx
					.update(jobs)
					.set({
						status: 'running',
						attempts: due.attempts + 1,
						lockedAt: new Date(now),
						updatedAt: new Date(now)
					})
					.where(eq(jobs.id, due.id))
					.returning()
					.get();

				return claimed ?? null;
			},
			{ behavior: 'immediate' }
		);
	}

	complete(id: number): void {
		const now = this.now();

		this.db
			.update(jobs)
			.set({ status: 'done', lockedAt: null, lastError: null, updatedAt: new Date(now) })
			.where(eq(jobs.id, id))
			.run();
	}

	/**
	 * Records a failed attempt. Below maxAttempts the job goes back to pending with the tech.md 6
	 * backoff; at or above it the job is terminal and the worker alerts the admin.
	 */
	fail(id: number, error: unknown, opts?: FailOptions): void {
		const now = this.now();
		// Never store the raw throw: an upstream error can carry a token or a whole webhook body.
		const lastError = redactText(error).slice(0, LAST_ERROR_MAX_CHARS);

		this.db.transaction(
			(tx) => {
				const row = tx.select().from(jobs).where(eq(jobs.id, id)).get();
				if (!row) return;

				const terminal = opts?.terminal === true || row.attempts >= row.maxAttempts;

				tx.update(jobs)
					.set({
						status: terminal ? 'failed' : 'pending',
						runAt: terminal ? row.runAt : new Date(now + backoffMs(row.attempts)),
						lockedAt: null,
						lastError,
						updatedAt: new Date(now)
					})
					.where(eq(jobs.id, id))
					.run();
			},
			{ behavior: 'immediate' }
		);
	}

	/** The worker reads the post-fail status to decide on the admin alert (tech.md 6). */
	find(id: number): JobRow | null {
		return this.db.select().from(jobs).where(eq(jobs.id, id)).get() ?? null;
	}

	/**
	 * Rows still marked running. claim() only ever looks at `pending`, so a row that a dying process
	 * left behind is invisible to it and would sit here until someone edited the table by hand.
	 * Only the worker calls this, and only at startup — see JobWorker.recoverOrphans for why that
	 * timing is the thing that makes "running" unambiguously mean "abandoned".
	 */
	findRunning(): JobRow[] {
		return this.db
			.select()
			.from(jobs)
			.where(eq(jobs.status, 'running'))
			.orderBy(asc(jobs.id))
			.all();
	}

	/**
	 * Jobs that ran out of attempts, most recently failed first (A16). `updatedAt` is the moment of
	 * the last attempt, which is what an admin scanning the panel is actually ordering by — `runAt`
	 * on a terminal row is frozen at whenever the last retry had been scheduled for.
	 *
	 * Bounded by default: a queue that has been failing for a week must not turn the admin screen
	 * into a several-thousand-row render.
	 */
	listFailed(limit = 20): JobRow[] {
		return this.db
			.select()
			.from(jobs)
			.where(eq(jobs.status, 'failed'))
			.orderBy(desc(jobs.updatedAt), desc(jobs.id))
			.limit(limit)
			.all();
	}
}

function backoffMs(attempts: number): number {
	return Math.min(2 ** attempts * RETRY_BASE_MS, RETRY_CAP_MS);
}
