import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { PromoCodeDTO, PromoError, Result } from '$lib/types';
import type { Db } from '../db/client';
import { promoCodes, promoRedemptions, type PromoCodeRow } from '../db/schema';
import type { PromoInput } from './input';
import type { OrderService } from './order-service';
import { toPromoAdminView, type PromoAdminView } from './promo-view';
import type { PromoValidator } from './promo-validator';

export interface RedeemPromoInput {
	promoCodeId: number;
	userId: number;
	orderId: number;
}

/**
 * How a redemption ended. Deliberately not PromoError: these are outcomes of spending a code that
 * was already accepted and already paid for, and only the provision job ever sees them. Mixing them
 * into the customer-facing union would offer the profile words it can never say.
 */
export type RedeemOutcome =
	/** This call wrote the redemption and moved the counter. */
	| 'redeemed'
	/** A previous run already did. The retried job has nothing left to do. */
	| 'already_redeemed'
	/** The code ran out between the quote and the payment. Nothing was written. */
	| 'exhausted';

/** Rolls the redemption row back when the counter cannot move. Never escapes this module. */
class PromoExhausted extends Error {}

export interface PromoServiceOptions {
	now?: () => number;
}

/**
 * The `promo_codes` and `promo_redemptions` tables, owned by one class (A10).
 *
 * It splits into two jobs that happen at very different moments. `resolve` answers "may this person
 * use this code" while they are still looking at the price, and changes nothing. `redeem` spends the
 * code, and runs much later — after the money has landed, from the provision job (tech.md 6).
 *
 * Nothing here decides the rules; PromoValidator does, without a database. This class supplies it
 * with the row and the counts and then writes down what it decided.
 */
export class PromoService {
	private readonly now: () => number;

	constructor(
		private readonly db: Db,
		private readonly validator: PromoValidator,
		private readonly orders: OrderService,
		opts: PromoServiceOptions = {}
	) {
		this.now = opts.now ?? Date.now;
	}

	/** tech.md 5 stores the code UPPERCASE, so that is the only spelling this table is asked about. */
	findByCode(code: string): PromoCodeRow | null {
		return (
			this.db
				.select()
				.from(promoCodes)
				.where(eq(promoCodes.code, code.trim().toUpperCase()))
				.get() ?? null
		);
	}

	/**
	 * How many times this person has already spent this code. Zero or one in practice — the unique
	 * index on (promoCodeId, userId) makes anything else impossible — but counted rather than
	 * existence-checked so the validator's argument means what its name says.
	 */
	redemptionCount(promoCodeId: number, userId: number): number {
		const row = this.db
			.select({ count: sql<number>`count(*)` })
			.from(promoRedemptions)
			.where(
				and(eq(promoRedemptions.promoCodeId, promoCodeId), eq(promoRedemptions.userId, userId))
			)
			.get();

		return row?.count ?? 0;
	}

	/**
	 * Whether this person may buy with this code right now, and what it is worth.
	 *
	 * The count handed to the validator is redemptions **plus this person's own unsettled orders
	 * already quoted with this code**. Only the first is a redemption in the schema's sense, and the
	 * difference matters: the row is written by the provision job, long after the payment, so from
	 * the moment a checkout opens until the job runs there is nothing to find. Counting rows alone
	 * would let somebody open the payment page twice and pay both — two orders discounted, one
	 * redemption written, the second discount given away. Counting the order closes that window at
	 * the point where the price is decided.
	 *
	 * `pending` and `paid` both count. An abandoned `pending` order does not lock the code forever:
	 * Stripe expires the session after thirty minutes (tech.md 10) and the webhook settles it to
	 * `failed`, which drops it back out. A `paid` one never drains, and should not — it has bought the
	 * discount whether or not the job has caught up with it yet.
	 */
	resolve(code: string, userId: number, now = this.now()): Result<PromoCodeDTO, PromoError> {
		const promo = this.findByCode(code);
		if (!promo) return this.validator.check(null, 0, now);

		const spent =
			this.redemptionCount(promo.id, userId) +
			this.orders.countUnsettledWithPromo(userId, promo.id);

		return this.validator.check(promo, spent, now);
	}

	/**
	 * Spends the code against one paid order (tech.md 10: the check and the increment share one
	 * `BEGIN IMMEDIATE` with the redemption row).
	 *
	 * Idempotent, because the job that calls it is retried: the insert is refused by the unique index
	 * on `orderId` when this order has already redeemed, and by `promo_once_per_user` when this person
	 * has already spent the code on another one. `usedCount` moves only when a row was actually
	 * written, so ten runs of the same job leave one redemption and one increment.
	 *
	 * The increment carries the `maxUses` test in its own WHERE clause rather than trusting the check
	 * `resolve` did earlier. Those two moments are minutes apart — a person quotes a code, walks to a
	 * payment page, and pays after somebody else has taken the last use — and without the test here
	 * `usedCount` would climb past `maxUses` and the ledger would stop meaning anything. When the
	 * counter cannot move, the redemption row goes back with it: a redemption that was never counted
	 * would be worse than none at all.
	 */
	redeem(input: RedeemPromoInput): RedeemOutcome {
		try {
			return this.db.transaction(
				(tx): RedeemOutcome => {
					const inserted = tx
						.insert(promoRedemptions)
						.values({
							promoCodeId: input.promoCodeId,
							userId: input.userId,
							orderId: input.orderId,
							createdAt: new Date(this.now())
						})
						// No target: either unique index may be the one that fires, and both mean the same
						// thing here — this code is already spent, leave the counter alone.
						.onConflictDoNothing()
						.returning()
						.get();

					if (!inserted) return 'already_redeemed';

					// Incremented from the column rather than from a value read a moment ago, so the
					// arithmetic stays in one statement and cannot lose an update.
					const counted = tx
						.update(promoCodes)
						.set({ usedCount: sql`${promoCodes.usedCount} + 1` })
						.where(
							and(
								eq(promoCodes.id, input.promoCodeId),
								or(isNull(promoCodes.maxUses), lt(promoCodes.usedCount, promoCodes.maxUses))
							)
						)
						.returning()
						.get();

					if (!counted) throw new PromoExhausted();

					return 'redeemed';
				},
				{ behavior: 'immediate' }
			);
		} catch (error) {
			// The only throw this method makes on purpose. Anything else is a database in trouble and
			// belongs to the caller, who will retry the whole job.
			if (error instanceof PromoExhausted) return 'exhausted';
			throw error;
		}
	}

	/**
	 * A11 — what the admin can still act on: live codes, switched-off ones included, archived ones
	 * excluded. Newest first, because a promo list is a log of campaigns rather than a price list and
	 * the one just created is the one being worked on.
	 *
	 * Archived rows stay out for the same reason they do on the plans screen: archiving is the delete
	 * path, and a retired code that kept appearing would only invite an edit that comes back refused.
	 */
	listEditable(): PromoAdminView[] {
		return this.db
			.select()
			.from(promoCodes)
			.where(isNull(promoCodes.archivedAt))
			.orderBy(desc(promoCodes.createdAt), desc(promoCodes.id))
			.all()
			.map(toPromoAdminView);
	}

	/**
	 * Refused when the code is taken (`code` is unique, tech.md 5). That is an ordinary thing for an
	 * admin to do — two campaigns, one obvious name — so it comes back as a Result rather than as a
	 * unique-constraint exception surfacing as a 500 (CLAUDE.md 3).
	 */
	create(input: PromoInput): Result<PromoAdminView, 'code_taken'> {
		if (this.findByCode(input.code)) return { ok: false, error: 'code_taken' };

		const row = this.db
			.insert(promoCodes)
			.values({ ...input, usedCount: 0, createdAt: new Date(this.now()), archivedAt: null })
			.returning()
			.get();

		return { ok: true, value: toPromoAdminView(row) };
	}

	/**
	 * `usedCount` is never in `input`: it is the ledger of what has actually been spent, and letting a
	 * form rewrite it would break the only agreement `maxUses` has with reality. Lowering `maxUses`
	 * below what is already spent is allowed and simply retires the code — `PromoValidator` reads it
	 * as exhausted from the next check onwards.
	 */
	update(
		id: number,
		input: PromoInput
	): Result<PromoAdminView, 'not_found' | 'archived' | 'code_taken'> {
		const existing = this.db.select().from(promoCodes).where(eq(promoCodes.id, id)).get();

		if (!existing) return { ok: false, error: 'not_found' };
		// Archiving is final, exactly as it is for a plan: an edit must not put a retired code back in
		// front of customers.
		if (existing.archivedAt) return { ok: false, error: 'archived' };

		const clash = this.findByCode(input.code);
		if (clash && clash.id !== id) return { ok: false, error: 'code_taken' };

		const row = this.db
			.update(promoCodes)
			.set(input)
			.where(eq(promoCodes.id, id))
			.returning()
			.get();

		return { ok: true, value: toPromoAdminView(row) };
	}

	/**
	 * Soft delete (tech.md 5): `promo_redemptions` and `orders` point at this row, so it is retired,
	 * never removed. Idempotent — archiving twice reports the code it already archived instead of
	 * moving the date, so a double-submitted form cannot rewrite history.
	 */
	archive(id: number): Result<PromoAdminView, 'not_found'> {
		const existing = this.db.select().from(promoCodes).where(eq(promoCodes.id, id)).get();

		if (!existing) return { ok: false, error: 'not_found' };
		if (existing.archivedAt) return { ok: true, value: toPromoAdminView(existing) };

		// isActive goes down with it. The validator already refuses on archivedAt alone, but leaving a
		// live flag behind means every future read has to remember which column wins.
		const row = this.db
			.update(promoCodes)
			.set({ archivedAt: new Date(this.now()), isActive: false })
			.where(eq(promoCodes.id, id))
			.returning()
			.get();

		return { ok: true, value: toPromoAdminView(row) };
	}
}
