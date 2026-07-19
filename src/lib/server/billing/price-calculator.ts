import {
	MIN_CHARGE_MINOR,
	type PlanSnapshot,
	type PriceQuote,
	type PromoCodeDTO
} from '$lib/types';

/**
 * The price, and nothing else (tech.md 10). No DB, no clock, no network — which is what lets the
 * invariants below be checked with generated input rather than with three hand-picked examples.
 *
 * Whether a promo code may be used at all is PromoValidator's question; this one only spends the
 * discount it is handed. Splitting them is what keeps the arithmetic pure: eligibility needs the
 * clock and the redemption count, and neither belongs anywhere near money arithmetic.
 */
export class PriceCalculator {
	/**
	 * Invariants, each one asserted by a property test in price-calculator.spec.ts:
	 *  - finalPriceMinor >= MIN_CHARGE_MINOR[currency] whenever the plan itself clears that floor;
	 *  - finalPriceMinor <= basePriceMinor;
	 *  - discountMinor === basePriceMinor - finalPriceMinor;
	 *  - every field is a non-negative integer.
	 */
	quote(plan: PlanSnapshot, promo: PromoCodeDTO | null): PriceQuote {
		const basePriceMinor = plan.priceMinor;
		const floor = MIN_CHARGE_MINOR[plan.currency];

		// A discount that would take the price under Stripe's minimum stops AT the minimum rather
		// than at zero (tech.md 10): a charge below it is refused outright, and a free order would
		// hand out a subscription that no payment webhook can ever confirm.
		//
		// The lower clamp is skipped when the plan is priced under the floor already. That plan
		// cannot be sold at all, and raising its price here would charge somebody more than the
		// card they are looking at — PlanInputParser is what refuses it, at the point it is typed.
		const lowest = Math.min(floor, basePriceMinor);
		const finalPriceMinor = clamp(
			basePriceMinor - discountOf(promo, basePriceMinor),
			lowest,
			basePriceMinor
		);

		return {
			basePriceMinor,
			// Derived from the final price rather than from the promo: after clamping, the discount
			// actually granted is the only honest thing to record, and orders stores all three.
			discountMinor: basePriceMinor - finalPriceMinor,
			finalPriceMinor,
			currency: plan.currency,
			promoCode: promo?.code ?? null
		};
	}
}

/**
 * Rounds down, always (tech.md 10). Rounding a percentage up would charge a cent the person was
 * never shown, and across a price list that is the kind of difference people notice.
 */
function discountOf(promo: PromoCodeDTO | null, basePriceMinor: number): number {
	if (!promo) return 0;

	return promo.discountType === 'percent'
		? Math.floor((basePriceMinor * promo.discountValue) / 100)
		: promo.discountValue;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}
