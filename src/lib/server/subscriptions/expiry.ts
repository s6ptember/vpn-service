/**
 * When a subscription ends, as pure arithmetic: no DB, no clock, no network (CLAUDE.md 3). Time
 * arrives as a parameter, which is what lets the invariants below be checked with generated input.
 */

export const DAY_MS = 86_400_000;

/** One paid order, reduced to the only two things that move the end date. */
export interface PaidTerm {
	/** Epoch ms the money actually landed — `orders.paidAt`, never `createdAt`. */
	paidAtMs: number;
	durationDays: number;
}

export interface Term {
	startsAtMs: number;
	expiresAtMs: number;
}

/**
 * Folds every paid order of one person into the window their access covers.
 *
 * The rule is tech.md 10.9 and 17.3: a purchase extends from `max(the running end, the moment it
 * was paid)`, so 30 days bought on top of 12 active ones give 42 rather than 30. Applied over the
 * whole history rather than to "current expiry + days", and that difference is the point:
 *
 *   the result is a pure function of the orders table, so provisioning the same order twice writes
 *   the same date twice.
 *
 * It has to be. `subscription.provision` is retried on failure and re-run after the worker recovers
 * a job orphaned by a restart (jobs/worker.ts, recoverOrphans), and `subscriptions` carries no
 * column marking which order was last applied — the schema is frozen (tech.md 15). A handler that
 * simply added days to the row it read would hand out a second month for free on every retry.
 *
 * `terms` must be ordered by `paidAtMs` ascending; OrderService.listPaid returns exactly that.
 */
export function foldTerms(terms: readonly PaidTerm[]): Term | null {
	if (terms.length === 0) return null;

	let expiresAtMs = 0;

	for (const term of terms) {
		// Lapsed access restarts from the payment; live access is extended from where it ends.
		expiresAtMs = Math.max(expiresAtMs, term.paidAtMs) + term.durationDays * DAY_MS;
	}

	return { startsAtMs: terms[0].paidAtMs, expiresAtMs };
}

/**
 * Whole days remaining, rounded up: with eleven hours left a person still has "1 день", and
 * telling them "0" while the VPN works would be a lie in the alarming direction. Never negative —
 * an expired subscription has no days left, it has a date in the past.
 *
 * The one implementation, deliberately (CLAUDE.md 4): the profile screen and the expiry
 * notification job must agree about what "3 days left" means, or people get warned on the wrong day.
 */
export function daysLeft(expiresAtMs: number, nowMs: number): number {
	return Math.max(0, Math.ceil((expiresAtMs - nowMs) / DAY_MS));
}

/** Access is a date, not a flag: whatever the row says, an elapsed window is expired. */
export function isActiveAt(expiresAtMs: number, nowMs: number): boolean {
	return expiresAtMs > nowMs;
}
