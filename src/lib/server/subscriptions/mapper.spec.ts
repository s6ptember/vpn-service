import { describe, expect, it } from 'vitest';
import type { SubscriptionRow } from '../db/schema';
import { DAY_MS } from './expiry';
import { toSubscriptionDTO } from './mapper';

/**
 * `subscriptions` carries `marzbanUsername`, which tech.md 1.4 names as a thing that must not leave
 * the server, and `subscriptionUrl`, which is the VPN key itself and goes to its owner alone. This
 * mapper is the whole enforcement of both, so the key set is asserted exactly: a mapper rewritten
 * as `{ ...row }` passes every other test in the suite and fails only here.
 */

const NOW = 1_784_000_000_000;

const row = (overrides: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
	id: 1,
	userId: 7,
	planId: 3,
	marzbanUsername: 'tg_700000111',
	subscriptionUrl: 'https://sub.local/sub/tg_700000111',
	startsAt: new Date(NOW),
	expiresAt: new Date(NOW + 30 * DAY_MS),
	status: 'active',
	lastSyncedAt: new Date(NOW),
	createdAt: new Date(NOW),
	updatedAt: new Date(NOW),
	...overrides
});

describe('toSubscriptionDTO', () => {
	it('emits exactly the DTO keys and not one more', () => {
		const dto = toSubscriptionDTO(row(), '30 дней', NOW);

		expect(Object.keys(dto).sort()).toEqual([
			'daysLeft',
			'expiresAt',
			'planName',
			'status',
			'subscriptionUrl'
		]);
	});

	it('keeps the row columns off the DTO', () => {
		const dto = toSubscriptionDTO(row(), '30 дней', NOW) as unknown as Record<string, unknown>;

		// marzbanUsername is an internal handle. It does appear INSIDE subscriptionUrl, because
		// Marzban builds the link out of it — that link is the key and is meant to travel. What must
		// not travel is the row: no username field, no ids, no sync bookkeeping.
		expect(dto.marzbanUsername).toBeUndefined();
		expect(dto.userId).toBeUndefined();
		expect(dto.planId).toBeUndefined();
		expect(dto.lastSyncedAt).toBeUndefined();
	});

	it('counts the days that are left, not the ones that were bought', () => {
		const dto = toSubscriptionDTO(row(), '30 дней', NOW + 18 * DAY_MS);

		expect(dto.daysLeft).toBe(12);
		expect(dto.status).toBe('active');
	});

	it('calls an elapsed window expired however the row is flagged', () => {
		// `subscription.sweep` runs every five minutes; in between, the column lies.
		const dto = toSubscriptionDTO(row({ status: 'active' }), '30 дней', NOW + 31 * DAY_MS);

		expect(dto.status).toBe('expired');
		expect(dto.daysLeft).toBe(0);
	});

	it('leaves a revoked subscription revoked, because that was a decision', () => {
		const dto = toSubscriptionDTO(row({ status: 'revoked' }), '30 дней', NOW);

		expect(dto.status).toBe('revoked');
	});
});
