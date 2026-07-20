import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { subscriptions, type SubscriptionRow } from '../db/schema';

export interface UpsertSubscriptionInput {
	userId: number;
	planId: number;
	marzbanUsername: string;
	subscriptionUrl: string;
	startsAtMs: number;
	expiresAtMs: number;
	status: 'active' | 'expired' | 'revoked';
}

export interface SubscriptionServiceOptions {
	now?: () => number;
}

/**
 * The `subscriptions` table, owned by one class. Exactly one row per person (tech.md 17.3): the
 * unique index on user_id is what enforces it, and this class never tries to work around it.
 */
export class SubscriptionService {
	private readonly now: () => number;

	constructor(
		private readonly db: Db,
		opts: SubscriptionServiceOptions = {}
	) {
		this.now = opts.now ?? Date.now;
	}

	findByUser(userId: number): SubscriptionRow | null {
		return (
			this.db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).get() ?? null
		);
	}

	/** By primary key, for the jobs that are handed an id rather than a person (A15, A16). */
	findById(id: number): SubscriptionRow | null {
		return this.db.select().from(subscriptions).where(eq(subscriptions.id, id)).get() ?? null;
	}

	/**
	 * Moves every subscription whose window has closed to `expired` and reports which ones moved
	 * (A15). One statement, so no transaction: SQLite applies an UPDATE atomically on its own, and
	 * RETURNING tells us what it touched without a second read that another writer could slip past.
	 *
	 * Convergent by construction, which is what makes `subscription.sweep` idempotent without a
	 * guard of its own: the WHERE clause matches only `active` rows, so a second run in the same
	 * window matches nothing and reports nothing. That also spares `revoked` — an access somebody
	 * revoked by hand is a decision, and letting a clock overwrite it with `expired` would erase the
	 * distinction between "the term ran out" and "we cut it off".
	 *
	 * Marzban is deliberately not called here. The panel enforces its own `expire` — it was set at
	 * provision time (jobs/handlers/subscription-provision.ts) — so access has already stopped on its
	 * own, and a sweep that made a network call per lapsed row would fail the whole batch on one
	 * timeout. Drift between the two is what `marzban.reconcile` is for (A16).
	 */
	expireLapsed(nowMs: number): { expiredIds: number[] } {
		const rows = this.db
			.update(subscriptions)
			.set({ status: 'expired', updatedAt: new Date(this.now()) })
			.where(and(eq(subscriptions.status, 'active'), lte(subscriptions.expiresAt, new Date(nowMs))))
			.returning({ id: subscriptions.id })
			.all();

		return { expiredIds: rows.map((row) => row.id) };
	}

	/**
	 * Live subscriptions ending inside `windowMs` from now, soonest first (A15).
	 *
	 * The window is half-open — `expiresAt > now` — so a row that has already lapsed belongs to
	 * expireLapsed and is never warned about: telling somebody their access ends in zero days after
	 * it has ended is noise at the worst moment.
	 *
	 * This is the query `subs_expires_idx` (tech.md 5) was put in the schema for; nothing else in the
	 * codebase reads the table by date.
	 */
	listExpiringWithin(nowMs: number, windowMs: number): SubscriptionRow[] {
		return this.db
			.select()
			.from(subscriptions)
			.where(
				and(
					eq(subscriptions.status, 'active'),
					gt(subscriptions.expiresAt, new Date(nowMs)),
					lte(subscriptions.expiresAt, new Date(nowMs + windowMs))
				)
			)
			.orderBy(asc(subscriptions.expiresAt), asc(subscriptions.id))
			.all();
	}

	/**
	 * Writes the person's one row, creating it on the first purchase and overwriting it on every
	 * one after that.
	 *
	 * Overwriting rather than incrementing is what makes `subscription.provision` idempotent: the
	 * values handed in are a pure function of the paid orders (see expiry.ts), so running the same
	 * job twice writes the same row twice. `marzbanUsername` is deliberately in the update set even
	 * though it never changes — leaving a column out of an upsert is how a rename silently stops
	 * propagating later.
	 */
	upsert(input: UpsertSubscriptionInput): SubscriptionRow {
		const timestamp = new Date(this.now());

		return this.db
			.insert(subscriptions)
			.values({
				userId: input.userId,
				planId: input.planId,
				marzbanUsername: input.marzbanUsername,
				subscriptionUrl: input.subscriptionUrl,
				startsAt: new Date(input.startsAtMs),
				expiresAt: new Date(input.expiresAtMs),
				status: input.status,
				lastSyncedAt: timestamp,
				createdAt: timestamp,
				updatedAt: timestamp
			})
			.onConflictDoUpdate({
				target: subscriptions.userId,
				set: {
					planId: input.planId,
					marzbanUsername: input.marzbanUsername,
					subscriptionUrl: input.subscriptionUrl,
					startsAt: new Date(input.startsAtMs),
					expiresAt: new Date(input.expiresAtMs),
					status: input.status,
					lastSyncedAt: timestamp,
					updatedAt: timestamp
					// createdAt stays put: it records when this person first had a subscription.
				}
			})
			.returning()
			.get();
	}
}
