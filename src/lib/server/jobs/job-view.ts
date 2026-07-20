import type { JobRow } from '../db/schema';

/**
 * What the admin screen needs to see about a job that ran out of attempts (A16).
 *
 * ## Why this type exists at all
 *
 * `lib/types/jobs.ts` carries `JobMap`, `JobType` and `JobStatus` — the contract the queue runs on —
 * and nothing shaped for a screen. tech.md 11 asks the panel for a list of failed jobs, and
 * `lib/types` is the lead's (tech.md 15). So this is the local stub CLAUDE.md 0 prescribes while the
 * CONTRACT GAP for a `JobAdminDTO` is open: it lives in the domain that owns the queue, is never
 * returned to a customer-facing route, and is meant to be deleted the day the contract lands.
 * `billing/promo-view.ts` is the precedent.
 *
 * Dates leave as milliseconds, like every other DTO in this project: a Date would be serialised to
 * an ISO string on the way to the page anyway, and the page would have to parse it back.
 *
 * ## What is deliberately left out
 *
 * `payload`. It is the one field on the row that carries domain data — a chat id, a message, an
 * order — and `log.ts` already lists `payload` among the keys `redact()` masks. A screen is not a
 * better place for it than a log line, and the id, the type and the error say everything an admin
 * needs to decide what to do next.
 */
export interface FailedJobView {
	id: number;
	type: string;
	attempts: number;
	maxAttempts: number;
	/** Already redacted and capped at 500 characters by JobQueue.fail. */
	lastError: string | null;
	updatedAt: number;
}

/** Row -> view in the domain, never hand-rolled in a +page.server.ts (CLAUDE.md 1.4). */
export function toFailedJobView(row: JobRow): FailedJobView {
	return {
		id: row.id,
		type: row.type,
		attempts: row.attempts,
		maxAttempts: row.maxAttempts,
		lastError: row.lastError,
		updatedAt: row.updatedAt.getTime()
	};
}
