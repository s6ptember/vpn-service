import { eq } from 'drizzle-orm';
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
