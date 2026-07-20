import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { Result } from '$lib/types';
import type { Db } from '../db/client';
import { supportTickets, type SupportTicketRow } from '../db/schema';
import type { JobQueue } from '../jobs/queue';

export interface CreateTicketInput {
	userId: number;
	/** Already parsed and trimmed by TicketInputParser. */
	message: string;
}

/** The one way creating a ticket can be refused. Expected, so it is a Result (CLAUDE.md 3). */
export interface TicketRateLimited {
	reason: 'rate_limited';
	/** Until the oldest of the counted tickets leaves the window, so the wait we quote is exact. */
	retryAfterSec: number;
}

/** CLAUDE.md 2: three support requests per hour per person. */
export const TICKET_LIMIT = 3;
export const TICKET_WINDOW_MS = 60 * 60 * 1000;

export interface SupportTicketServiceOptions {
	now?: () => number;
}

/**
 * The `support_tickets` table (A14): one row per request, one job per row.
 *
 * ## Why the limit is counted here and not in RateLimiter
 *
 * The other two limits in CLAUDE.md 2 guard cheap, repeatable guesses — an initData exchange, a
 * promo code — and an in-memory counter is right for those: it is spent in seconds and nothing is
 * lost if a deploy clears it. This one is different in three ways that all point at the table.
 *
 * The window is an hour, and a container restart inside it would hand everybody a fresh budget —
 * so the limit would be worth exactly as much as the app's uptime, and a deploy would be a way
 * around it. The thing being counted is already written down: every attempt that costs anything is
 * a durable row, so counting rows needs no second ledger to be kept in step with the first. And
 * `tickets_user_created_idx` on (user_id, created_at) is in the frozen schema (tech.md 5) for a
 * query nothing else in this codebase makes.
 *
 * Counting rows also makes the window rolling rather than fixed, which is what lets `retryAfterSec`
 * be the truth instead of an estimate, and it puts the check inside the same BEGIN IMMEDIATE as the
 * insert — two submissions racing cannot both read "two so far" and both write a third.
 */
export class SupportTicketService {
	private readonly now: () => number;

	constructor(
		private readonly db: Db,
		private readonly jobs: JobQueue,
		opts: SupportTicketServiceOptions = {}
	) {
		this.now = opts.now ?? Date.now;
	}

	/**
	 * Writes the request and queues the notification in one transaction.
	 *
	 * Both halves or neither, and that is the point (the same reason PaymentWebhookService writes
	 * its dedupe row and its job together): a ticket with no job is a message nobody is ever told
	 * about, sitting in a table only the admin screen reads. `this.jobs` holds the same
	 * better-sqlite3 connection as `this.db`, so its insert joins this transaction without being
	 * handed `tx`.
	 *
	 * BEGIN IMMEDIATE takes the write lock before the count is read, which is what makes the limit
	 * a limit: a double-tapped form cannot get two rows past a budget with room for one.
	 */
	create(input: CreateTicketInput): Result<SupportTicketRow, TicketRateLimited> {
		const now = this.now();

		return this.db.transaction(
			(tx): Result<SupportTicketRow, TicketRateLimited> => {
				const recent = tx
					.select({ createdAt: supportTickets.createdAt })
					.from(supportTickets)
					.where(
						and(
							eq(supportTickets.userId, input.userId),
							gt(supportTickets.createdAt, new Date(now - TICKET_WINDOW_MS))
						)
					)
					.orderBy(desc(supportTickets.createdAt))
					.limit(TICKET_LIMIT)
					.all();

				if (recent.length >= TICKET_LIMIT) {
					// The budget frees up when the OLDEST of the counted rows leaves the window. Ceil, so
					// somebody who waits exactly this long lands after the reset rather than on it.
					const frees = recent[recent.length - 1].createdAt.getTime() + TICKET_WINDOW_MS;
					return {
						ok: false,
						error: {
							reason: 'rate_limited',
							retryAfterSec: Math.max(1, Math.ceil((frees - now) / 1000))
						}
					};
				}

				const row = tx
					.insert(supportTickets)
					.values({
						userId: input.userId,
						message: input.message,
						status: 'new',
						adminMessageId: null,
						createdAt: new Date(now),
						deliveredAt: null
					})
					.returning()
					.get();

				// tech.md 6: one ticket, one notification, held to that by the unique key.
				this.jobs.enqueue('support.notify_admin', { ticketId: row.id }, `ticket:${row.id}`);

				return { ok: true, value: row };
			},
			{ behavior: 'immediate' }
		);
	}

	findById(id: number): SupportTicketRow | null {
		return this.db.select().from(supportTickets).where(eq(supportTickets.id, id)).get() ?? null;
	}

	/**
	 * The message reached the admin. `adminMessageId` is the thread back to it (tech.md 6) and is
	 * what makes the delivered state provable rather than merely claimed — so the two columns and
	 * the status are always written by this one statement, never apart.
	 *
	 * `deliveredAt IS NULL` in the WHERE is the same guard `OrderService.markPaid` puts on a
	 * settled order: a ticket is delivered once, and a second write would replace the id of the
	 * message the admin is actually looking at with the id of a duplicate. `changed` tells the
	 * caller which run it was.
	 */
	markDelivered(id: number, adminMessageId: number): { changed: boolean } {
		const row = this.db
			.update(supportTickets)
			.set({ status: 'delivered', adminMessageId, deliveredAt: new Date(this.now()) })
			.where(and(eq(supportTickets.id, id), isNull(supportTickets.deliveredAt)))
			.returning()
			.get();

		return { changed: Boolean(row) };
	}

	/**
	 * The last attempt to deliver it did not land. Written on every failed attempt rather than only
	 * on the terminal one, because the handler cannot know which attempt is the last — the queue
	 * owns that decision (jobs/worker.ts). So the column reads as the outcome of the latest attempt,
	 * and a retry that succeeds moves it to `delivered` on its own.
	 *
	 * Never over a delivered row: a message that already reached the admin stays delivered whatever
	 * happens afterwards.
	 */
	markFailed(id: number): void {
		this.db
			.update(supportTickets)
			.set({ status: 'failed' })
			.where(and(eq(supportTickets.id, id), isNull(supportTickets.deliveredAt)))
			.run();
	}
}
