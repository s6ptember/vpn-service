import type * as v from 'valibot';
import type { JobMap, JobType } from '$lib/types';

/**
 * The one place inheritance earns its keep (CLAUDE.md 3): every job shares this contract, and the
 * worker dispatches on it without knowing a single concrete handler.
 *
 * A handler must be idempotent ON ITS OWN, not merely on insert (tech.md 6). The unique
 * idempotency key stops a duplicate row; it does nothing about a job that ran, timed out on the
 * response, and gets retried. Two runs of the same payload produce exactly one effect — so a
 * handler that writes checks for its own write first, and one that calls a third party leans on a
 * key that third party deduplicates by.
 *
 * Handlers return nothing. Anything the next step needs goes back on the queue as a new job, which
 * keeps every unit of work retryable on its own.
 */
export abstract class JobHandler<T extends JobType> {
	abstract readonly type: T;

	/**
	 * Payload validation seam. The worker parses the stored JSON with this before calling handle(),
	 * so no unparsed data reaches the domain (CLAUDE.md 2). The row is JSON written by an older
	 * deploy at best and hand-edited at worst: it is untrusted input like any other.
	 */
	abstract readonly schema: v.GenericSchema<unknown, JobMap[T]>;

	abstract handle(payload: JobMap[T]): Promise<void>;
}
