import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DAY_MS, daysLeft, foldTerms, isActiveAt, type PaidTerm } from './expiry';

/**
 * The invariants are tech.md's, not the implementation's: 10.9 ("продление активной подписки
 * прибавляет дни, а не обнуляет их") and 17.3 ("30 дней при активных 12 даёт 42").
 *
 * Two of the specs below — the ones that pin the END of a single term — encode the anchor rather
 * than only the rule, and that anchor is the subject of an open CONTRACT GAP: tech.md 10.9 writes
 * the formula as `max(now, currentExpiresAt) + days`, which cannot be idempotent because `now`
 * moves between a job and its retry, while tech.md 6 demands idempotency without exception. This
 * code resolves the conflict towards `paidAt`, and those two specs say so out loud so that nobody
 * reads them as the frozen contract before the lead has ruled.
 *
 * In practice the two formulas agree: paidAt is stamped by our own clock when the webhook lands,
 * and the provision job runs within seconds of it. They diverge only by however long the queue was
 * behind — and paidAt is the reading that does not charge that delay to the customer.
 *
 * Idempotency itself is NOT tested here. `foldTerms(x) === foldTerms(x)` is true of every pure
 * function and would prove nothing; the real test runs the handler twice against a real database in
 * jobs/handlers/subscription-provision.spec.ts.
 */

const JULY_2026 = 1_784_000_000_000;

const term = (): fc.Arbitrary<PaidTerm> =>
	fc.record({
		paidAtMs: fc.integer({ min: JULY_2026, max: JULY_2026 + 400 * DAY_MS }),
		durationDays: fc.integer({ min: 1, max: 365 })
	});

/** Paid orders reach the fold ordered by payment time; OrderService.listPaid guarantees it. */
const history = (constraints: { minLength?: number } = {}) =>
	fc
		.array(term(), { minLength: constraints.minLength ?? 0, maxLength: 12 })
		.map((terms) => [...terms].sort((a, b) => a.paidAtMs - b.paidAtMs));

describe('foldTerms', () => {
	it('has nothing to say about a person who never paid', () => {
		expect(foldTerms([])).toBeNull();
	});

	// Anchored on paidAt: the open CONTRACT GAP above, not the frozen wording of tech.md 10.9.
	it('ends a single purchase exactly its duration after the payment', () => {
		fc.assert(
			fc.property(term(), (single) => {
				const folded = foldTerms([single]);
				expect(folded).toEqual({
					startsAtMs: single.paidAtMs,
					expiresAtMs: single.paidAtMs + single.durationDays * DAY_MS
				});
			})
		);
	});

	it('never moves the end date backwards when another purchase is added', () => {
		fc.assert(
			fc.property(history({ minLength: 1 }), term(), (terms, extra) => {
				const before = foldTerms(terms)!;
				// A later purchase: appending keeps the list ordered by paidAt.
				const after = foldTerms([
					...terms,
					{ ...extra, paidAtMs: terms[terms.length - 1].paidAtMs + extra.paidAtMs - JULY_2026 }
				])!;

				expect(after.expiresAtMs).toBeGreaterThan(before.expiresAtMs);
				// The first payment is what the access started from, whatever came after.
				expect(after.startsAtMs).toBe(before.startsAtMs);
			})
		);
	});

	it('adds the days to a subscription that is still running', () => {
		fc.assert(
			fc.property(history({ minLength: 1 }), fc.integer({ min: 1, max: 365 }), (terms, days) => {
				const before = foldTerms(terms)!;
				// Paid while the current window is still open, which is the renewal case.
				const renewal: PaidTerm = { paidAtMs: before.expiresAtMs - 1, durationDays: days };
				const after = foldTerms([...terms, renewal])!;

				// tech.md 17.3: the days stack, they do not reset the clock.
				expect(after.expiresAtMs).toBe(before.expiresAtMs + days * DAY_MS);
			})
		);
	});

	// Same caveat: the RULE (a lapsed subscription does not backdate) is tech.md's; the anchor is the gap's.
	it('restarts from the payment when the subscription had already lapsed', () => {
		fc.assert(
			fc.property(history({ minLength: 1 }), fc.integer({ min: 1, max: 365 }), (terms, days) => {
				const before = foldTerms(terms)!;
				const comeback: PaidTerm = { paidAtMs: before.expiresAtMs + DAY_MS, durationDays: days };
				const after = foldTerms([...terms, comeback])!;

				// Nobody is owed the days they were away for.
				expect(after.expiresAtMs).toBe(comeback.paidAtMs + days * DAY_MS);
			})
		);
	});

	it('turns 12 active days plus a 30-day purchase into 42', () => {
		// tech.md 17.3, spelled out.
		const first: PaidTerm = { paidAtMs: JULY_2026, durationDays: 30 };
		const second: PaidTerm = { paidAtMs: JULY_2026 + 18 * DAY_MS, durationDays: 30 };

		const folded = foldTerms([first, second])!;

		expect(folded.expiresAtMs).toBe(JULY_2026 + 60 * DAY_MS);
		// 42 days from the moment of the second purchase.
		expect(daysLeft(folded.expiresAtMs, second.paidAtMs)).toBe(42);
	});
});

describe('daysLeft', () => {
	it('never goes negative', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: JULY_2026, max: JULY_2026 + 400 * DAY_MS }),
				fc.integer({ min: JULY_2026, max: JULY_2026 + 400 * DAY_MS }),
				(expiresAtMs, nowMs) => {
					expect(daysLeft(expiresAtMs, nowMs)).toBeGreaterThanOrEqual(0);
				}
			)
		);
	});

	it('rounds a part-day up, so the last day is still a day', () => {
		expect(daysLeft(JULY_2026 + DAY_MS, JULY_2026)).toBe(1);
		expect(daysLeft(JULY_2026 + DAY_MS - 1, JULY_2026)).toBe(1);
		expect(daysLeft(JULY_2026 + 1, JULY_2026)).toBe(1);
		expect(daysLeft(JULY_2026, JULY_2026)).toBe(0);
		expect(daysLeft(JULY_2026 - DAY_MS, JULY_2026)).toBe(0);
	});
});

describe('isActiveAt', () => {
	it('calls a window that has elapsed expired, whatever the row says', () => {
		expect(isActiveAt(JULY_2026 + 1, JULY_2026)).toBe(true);
		expect(isActiveAt(JULY_2026, JULY_2026)).toBe(false);
		expect(isActiveAt(JULY_2026 - 1, JULY_2026)).toBe(false);
	});
});
