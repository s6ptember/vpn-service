import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CURRENCIES, MIN_CHARGE_MINOR, type PlanSnapshot, type PromoCodeDTO } from '$lib/types';
import { PriceCalculator } from './price-calculator';

/**
 * The invariants come from tech.md 10, not from reading the class: they are the contract the rest
 * of the system leans on. Stripe refuses a charge under MIN_CHARGE_MINOR, orders stores all three
 * amounts, and the checkout hands finalPriceMinor straight to unit_amount — so a broken invariant
 * here is a refused payment or a wrong charge, not a cosmetic bug.
 */

const calculator = new PriceCalculator();

const currency = fc.constantFrom(...CURRENCIES);

/** Sellable plans only: PlanInputParser already refuses anything under the floor at the form. */
const sellablePlan = (): fc.Arbitrary<PlanSnapshot> =>
	currency.chain((c) =>
		fc.record({
			name: fc.constant('план'),
			durationDays: fc.integer({ min: 1, max: 3650 }),
			priceMinor: fc.integer({ min: MIN_CHARGE_MINOR[c], max: 1_000_000 }),
			currency: fc.constant(c),
			trafficLimitBytes: fc.constant(0)
		})
	);

const promo = (): fc.Arbitrary<PromoCodeDTO> =>
	fc.oneof(
		fc.record({
			id: fc.constant(1),
			code: fc.constant('PERCENT'),
			discountType: fc.constant('percent' as const),
			discountValue: fc.integer({ min: 1, max: 100 })
		}),
		fc.record({
			id: fc.constant(2),
			code: fc.constant('FIXED'),
			discountType: fc.constant('fixed' as const),
			// Deliberately allowed to exceed any plan price: the clamp is the thing under test.
			discountValue: fc.integer({ min: 1, max: 2_000_000 })
		})
	);

const maybePromo = () => fc.option(promo(), { nil: null });

describe('PriceCalculator.quote', () => {
	it('never charges under the Stripe minimum', () => {
		fc.assert(
			fc.property(sellablePlan(), maybePromo(), (plan, code) => {
				const quote = calculator.quote(plan, code);
				expect(quote.finalPriceMinor).toBeGreaterThanOrEqual(MIN_CHARGE_MINOR[plan.currency]);
			})
		);
	});

	it('never charges more than the price on the card', () => {
		fc.assert(
			fc.property(sellablePlan(), maybePromo(), (plan, code) => {
				const quote = calculator.quote(plan, code);
				expect(quote.finalPriceMinor).toBeLessThanOrEqual(quote.basePriceMinor);
				expect(quote.basePriceMinor).toBe(plan.priceMinor);
			})
		);
	});

	it('reports the discount it actually granted', () => {
		fc.assert(
			fc.property(sellablePlan(), maybePromo(), (plan, code) => {
				const quote = calculator.quote(plan, code);
				// The three amounts land in three columns of `orders`; they have to add up there.
				expect(quote.discountMinor).toBe(quote.basePriceMinor - quote.finalPriceMinor);
			})
		);
	});

	it('deals only in non-negative whole minor units', () => {
		fc.assert(
			fc.property(sellablePlan(), maybePromo(), (plan, code) => {
				const quote = calculator.quote(plan, code);
				for (const amount of [quote.basePriceMinor, quote.discountMinor, quote.finalPriceMinor]) {
					expect(Number.isInteger(amount)).toBe(true);
					expect(amount).toBeGreaterThanOrEqual(0);
				}
			})
		);
	});

	it('is pure: the same input always gives the same output', () => {
		fc.assert(
			fc.property(sellablePlan(), maybePromo(), (plan, code) => {
				expect(calculator.quote(plan, code)).toEqual(calculator.quote(plan, code));
			})
		);
	});

	it('carries the currency and the code through untouched', () => {
		fc.assert(
			fc.property(sellablePlan(), maybePromo(), (plan, code) => {
				const quote = calculator.quote(plan, code);
				expect(quote.currency).toBe(plan.currency);
				expect(quote.promoCode).toBe(code?.code ?? null);
			})
		);
	});

	it('rounds a percentage down', () => {
		// 999 * 33% = 329.67. Rounding up would charge a cent nobody was shown.
		const plan: PlanSnapshot = {
			name: '30 дней',
			durationDays: 30,
			priceMinor: 999,
			currency: 'usd',
			trafficLimitBytes: 0
		};

		const quote = calculator.quote(plan, {
			id: 1,
			code: 'START33',
			discountType: 'percent',
			discountValue: 33
		});

		expect(quote.discountMinor).toBe(329);
		expect(quote.finalPriceMinor).toBe(670);
	});

	it('leaves the price alone without a promo code', () => {
		const plan: PlanSnapshot = {
			name: '7 дней',
			durationDays: 7,
			priceMinor: 149,
			currency: 'usd',
			trafficLimitBytes: 0
		};

		expect(calculator.quote(plan, null)).toEqual({
			basePriceMinor: 149,
			discountMinor: 0,
			finalPriceMinor: 149,
			currency: 'usd',
			promoCode: null
		});
	});

	it('stops a 100% code at the Stripe floor instead of at zero', () => {
		const plan: PlanSnapshot = {
			name: '30 дней',
			durationDays: 30,
			priceMinor: 499,
			currency: 'usd',
			trafficLimitBytes: 0
		};

		const quote = calculator.quote(plan, {
			id: 1,
			code: 'FREE',
			discountType: 'percent',
			discountValue: 100
		});

		// A free order would need a payment webhook that Stripe will never send.
		expect(quote.finalPriceMinor).toBe(MIN_CHARGE_MINOR.usd);
		expect(quote.discountMinor).toBe(449);
	});
});
