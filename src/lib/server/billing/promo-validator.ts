import type { PromoCodeDTO, PromoError, Result } from '$lib/types';
import type { PromoCodeRow } from '../db/schema';

/**
 * May this code be used, right now, by this person (tech.md 10)?
 *
 * The signature is the one tech.md names, and its shape is the point: the row, the redemption count
 * and the clock all arrive as arguments, so the class holds no database handle and no `Date.now`.
 * That is what lets every branch below be checked with a table of inputs instead of by seeding rows
 * and waiting.
 *
 * Money is deliberately absent. PriceCalculator spends the discount; this only decides whether there
 * is one to spend, and splitting them keeps the arithmetic pure of the clock (CLAUDE.md 3).
 *
 * Every refusal is a PromoError — an expected outcome of the domain, not an exception (CLAUDE.md 3).
 * The person mistyped a code or came back for a second discount; nothing has gone wrong.
 */
export class PromoValidator {
	/**
	 * Checks in order of what the person can do about it: a code that does not exist, then one that
	 * is switched off, then the calendar, then the shared budget, then their own past use. The order
	 * is a contract of its own — it decides which single sentence the profile shows for a code that
	 * fails several rules at once, and the spec pins it.
	 */
	check(
		promo: PromoCodeRow | null,
		redemptions: number,
		now: number
	): Result<PromoCodeDTO, PromoError> {
		if (!promo) return refuse('not_found');

		// Archiving is the delete path for a promo, as it is for a plan (tech.md 5): the row survives
		// because promoRedemptions and orders point at it, and it must stop working the moment it is
		// retired, whatever isActive still says.
		if (promo.archivedAt !== null || !promo.isActive) return refuse('inactive');

		/**
		 * A window that has not opened yet is 'inactive', not 'expired': PromoError (tech.md 7, frozen)
		 * has one word for the calendar, and telling somebody a code has expired on the day before it
		 * starts would send them away from a discount they are about to be able to use.
		 */
		if (promo.validFrom !== null && now < promo.validFrom.getTime()) return refuse('inactive');
		if (promo.validUntil !== null && now > promo.validUntil.getTime()) return refuse('expired');

		// null maxUses is unlimited (tech.md 5). The count is the authority rather than the row's own
		// usedCount reaching it first: PromoService increments both in one transaction.
		if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) return refuse('exhausted');

		// One code, one person, once (tech.md 10). The unique index on (promoCodeId, userId) is what
		// actually enforces it; this is the sentence the person reads before the index has to.
		if (redemptions > 0) return refuse('already_used');

		return {
			ok: true,
			value: {
				id: promo.id,
				code: promo.code,
				discountType: promo.discountType,
				discountValue: promo.discountValue
			}
		};
	}
}

const refuse = (error: PromoError): Result<PromoCodeDTO, PromoError> => ({ ok: false, error });
