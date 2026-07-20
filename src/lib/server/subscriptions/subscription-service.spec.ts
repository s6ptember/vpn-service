import { beforeEach, describe, expect, it } from 'vitest';
import { addPlan, addUser } from '$lib/server/billing/fixtures';
import type { Db } from '$lib/server/db/client';
import { createTestDb, TestClock } from '$lib/server/jobs/fixtures';
import { DAY_MS } from './expiry';
import { SubscriptionService } from './subscription-service';

/**
 * A15's two reads, tested against the acceptance criterion rather than the statement: the sweep must
 * close windows that have ended and must find the people worth warning — without ever touching an
 * access somebody revoked by hand.
 */

const NOW = 1_784_000_000_000;

let db: Db;
let clock: TestClock;
let service: SubscriptionService;
let planId: number;
let nextTelegramId = 700_100_000;

/** One person, one subscription — the table holds exactly one row per user (tech.md 17.3). */
function addSubscription(expiresAtMs: number, status: 'active' | 'expired' | 'revoked'): number {
	const user = addUser(db, { telegramId: (nextTelegramId += 1) });

	return service.upsert({
		userId: user.id,
		planId,
		marzbanUsername: `tg_${user.telegramId}`,
		subscriptionUrl: `https://sub.local/sub/tg_${user.telegramId}`,
		startsAtMs: NOW - 30 * DAY_MS,
		expiresAtMs,
		status
	}).id;
}

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock(NOW);
	service = new SubscriptionService(db, { now: clock.now });
	planId = addPlan(db).id;
});

describe('SubscriptionService.expireLapsed', () => {
	it('closes a window that has ended and names the row it closed', () => {
		const id = addSubscription(NOW - DAY_MS, 'active');

		expect(service.expireLapsed(NOW)).toEqual({ expiredIds: [id] });
		expect(service.findById(id)?.status).toBe('expired');
	});

	it('leaves a subscription that still has time to run', () => {
		const id = addSubscription(NOW + DAY_MS, 'active');

		expect(service.expireLapsed(NOW).expiredIds).toEqual([]);
		expect(service.findById(id)?.status).toBe('active');
	});

	/**
	 * The boundary the whole job hinges on. `isActiveAt` reads access as `expiresAt > now`, so the
	 * instant the date is reached the window is closed — and this WHERE clause has to agree with it,
	 * or a subscription spends a sweep interval expired on the profile and active in the table.
	 */
	it('closes a window at the exact moment it ends', () => {
		const id = addSubscription(NOW, 'active');

		expect(service.expireLapsed(NOW).expiredIds).toEqual([id]);
	});

	/** Revoking is a decision somebody made; a clock must not quietly restate it as a lapsed term. */
	it('never overwrites a revoked subscription', () => {
		const id = addSubscription(NOW - DAY_MS, 'revoked');

		expect(service.expireLapsed(NOW).expiredIds).toEqual([]);
		expect(service.findById(id)?.status).toBe('revoked');
	});

	/**
	 * What makes the sweep idempotent without a guard of its own (tech.md 6): the second run has
	 * nothing left to match, so it reports nothing and the admin is not told twice.
	 */
	it('reports nothing on a second run over the same rows', () => {
		addSubscription(NOW - DAY_MS, 'active');

		expect(service.expireLapsed(NOW).expiredIds).toHaveLength(1);
		expect(service.expireLapsed(NOW).expiredIds).toEqual([]);
	});
});

describe('SubscriptionService.listExpiringWithin', () => {
	it('finds the subscriptions ending inside the window, soonest first', () => {
		const later = addSubscription(NOW + 3 * DAY_MS, 'active');
		const sooner = addSubscription(NOW + DAY_MS, 'active');
		addSubscription(NOW + 10 * DAY_MS, 'active');

		const found = service.listExpiringWithin(NOW, 3 * DAY_MS).map((row) => row.id);

		expect(found).toEqual([sooner, later]);
	});

	/** A window that has already closed belongs to expireLapsed. Warning about it would be a
	 *  notification that the access ends in zero days, sent after it ended. */
	it('skips a subscription that has already lapsed', () => {
		addSubscription(NOW - DAY_MS, 'active');

		expect(service.listExpiringWithin(NOW, 3 * DAY_MS)).toEqual([]);
	});

	it('skips expired and revoked rows whatever their date says', () => {
		addSubscription(NOW + DAY_MS, 'expired');
		addSubscription(NOW + DAY_MS, 'revoked');

		expect(service.listExpiringWithin(NOW, 3 * DAY_MS)).toEqual([]);
	});
});
