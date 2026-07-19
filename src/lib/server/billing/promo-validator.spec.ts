import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PromoError } from '$lib/types';
import type { PromoCodeRow } from '../db/schema';
import { PromoValidator } from './promo-validator';

/**
 * Derived from the acceptance criteria of A10, not from the class: tech.md 5 defines what each
 * column means, tech.md 7 freezes the five words a refusal may use, and tech.md 10 says one code is
 * one application per person. Each case below is one of those rules, phrased as the outcome a
 * customer would see.
 */

const validator = new PromoValidator();

const NOW = 1_784_000_000_000;
const DAY = 86_400_000;

function promoRow(overrides: Partial<PromoCodeRow> = {}): PromoCodeRow {
	return {
		id: 1,
		code: 'START30',
		discountType: 'percent',
		discountValue: 30,
		maxUses: null,
		usedCount: 0,
		validFrom: null,
		validUntil: null,
		isActive: true,
		createdAt: new Date(NOW - DAY),
		archivedAt: null,
		...overrides
	};
}

/** The error of a refusal, or the string 'ok' — one value to assert on either way. */
function outcome(promo: PromoCodeRow | null, redemptions = 0, now = NOW): PromoError | 'ok' {
	const result = validator.check(promo, redemptions, now);
	return result.ok ? 'ok' : result.error;
}

describe('PromoValidator.check', () => {
	it('accepts a live code and hands back exactly the frozen DTO', () => {
		const result = validator.check(promoRow(), 0, NOW);

		expect(result).toEqual({
			ok: true,
			// PromoCodeDTO (tech.md 7) and nothing else: usedCount and the window are the shop's
			// business, and this value is what the price calculator and the profile both read.
			value: { id: 1, code: 'START30', discountType: 'percent', discountValue: 30 }
		});
	});

	it('refuses a code that does not exist', () => {
		expect(outcome(null)).toBe('not_found');
	});

	it('refuses a switched-off code', () => {
		expect(outcome(promoRow({ isActive: false }))).toBe('inactive');
	});

	it('refuses an archived code even while it is still flagged active', () => {
		// Archiving is the delete path (tech.md 5); a stale isActive must not revive the discount.
		expect(outcome(promoRow({ isActive: true, archivedAt: new Date(NOW - DAY) }))).toBe('inactive');
	});

	it('refuses a code whose window has not opened yet', () => {
		// Not 'expired': the code works tomorrow, and sending somebody away from it would be a lie.
		expect(outcome(promoRow({ validFrom: new Date(NOW + DAY) }))).toBe('inactive');
	});

	it('accepts a code exactly at the moment its window opens', () => {
		expect(outcome(promoRow({ validFrom: new Date(NOW) }))).toBe('ok');
	});

	it('refuses a code past its window', () => {
		expect(outcome(promoRow({ validUntil: new Date(NOW - 1) }))).toBe('expired');
	});

	it('accepts a code on the last millisecond of its window', () => {
		// The column is a moment, not a day: validUntil is the last instant the code still works.
		expect(outcome(promoRow({ validUntil: new Date(NOW) }))).toBe('ok');
	});

	it('refuses a code whose uses are spent', () => {
		expect(outcome(promoRow({ maxUses: 500, usedCount: 500 }))).toBe('exhausted');
	});

	it('accepts a code with one use left', () => {
		expect(outcome(promoRow({ maxUses: 500, usedCount: 499 }))).toBe('ok');
	});

	it('treats a null maxUses as unlimited', () => {
		expect(outcome(promoRow({ maxUses: null, usedCount: 10_000 }))).toBe('ok');
	});

	it('refuses a second use by the same person', () => {
		// tech.md 10: one code, one application per person. The unique index enforces it; this is the
		// sentence they read before it has to.
		expect(outcome(promoRow(), 1)).toBe('already_used');
	});

	it('reports the most fixable problem first when several rules fail at once', () => {
		/**
		 * A code that is switched off AND expired AND spent AND already used says 'inactive'. The
		 * profile shows one line, so the order of the checks decides which one — and the earliest
		 * refusal is the one the shop can still do something about.
		 */
		const broken = promoRow({
			isActive: false,
			validUntil: new Date(NOW - DAY),
			maxUses: 1,
			usedCount: 1
		});

		expect(outcome(broken, 1)).toBe('inactive');
	});

	it('reads the clock it is handed, and no other', () => {
		/**
		 * The property that makes every other test here trustworthy: `now` is a parameter, so a code
		 * expiring at NOW is live for every argument up to NOW and dead for every one after it. A
		 * validator that reached for `Date.now()` instead would answer the same thing for all of them
		 * — and comparing two calls against each other would not notice, because that passes for any
		 * deterministic function, including a wrong one.
		 */
		fc.assert(
			fc.property(fc.integer({ min: NOW - 10 * DAY, max: NOW + 10 * DAY }), (now) => {
				const row = promoRow({ validUntil: new Date(NOW) });

				expect(validator.check(row, 0, now).ok).toBe(now <= NOW);
			})
		);
	});

	it('never accepts a code that any single rule refuses', () => {
		/**
		 * The property the rest of the system leans on: whatever combination of columns arrives, an
		 * acceptance means every rule passed. Checkout quotes a discount off the back of this answer,
		 * so a false positive is money given away.
		 */
		fc.assert(
			fc.property(
				fc.boolean(),
				fc.option(fc.integer({ min: 1, max: 3 }), { nil: null }),
				fc.integer({ min: 0, max: 4 }),
				fc.option(fc.integer({ min: -2, max: 2 }), { nil: null }),
				fc.option(fc.integer({ min: -2, max: 2 }), { nil: null }),
				fc.integer({ min: 0, max: 2 }),
				(isActive, maxUses, usedCount, fromDays, untilDays, redemptions) => {
					const row = promoRow({
						isActive,
						maxUses,
						usedCount,
						validFrom: fromDays === null ? null : new Date(NOW + fromDays * DAY),
						validUntil: untilDays === null ? null : new Date(NOW + untilDays * DAY)
					});

					const accepted = validator.check(row, redemptions, NOW).ok;

					const shouldPass =
						isActive &&
						(fromDays === null || NOW >= NOW + fromDays * DAY) &&
						(untilDays === null || NOW <= NOW + untilDays * DAY) &&
						(maxUses === null || usedCount < maxUses) &&
						redemptions === 0;

					expect(accepted).toBe(shouldPass);
				}
			)
		);
	});
});
