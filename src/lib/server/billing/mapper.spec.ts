import { describe, expect, it } from 'vitest';
import { ConfigError } from '../errors';
import { makeOrder } from '../clients/payments/fixtures';
import { toOrderDTO } from './mapper';

/**
 * The row -> DTO boundary is the only thing standing between `orders` and the SSR payload that a
 * person can read in devtools. CLAUDE.md 1.4 names the columns by hand: `providerPaymentIntentId`
 * must not go out, and neither must the rest of the row.
 *
 * So this asserts the exact key set rather than the fields it happens to care about. A mapper
 * rewritten as `{ ...row }` would satisfy every other test in the suite and fail only this one.
 */
describe('toOrderDTO', () => {
	it('emits exactly the DTO keys and not one more', () => {
		const dto = toOrderDTO(makeOrder());

		expect(Object.keys(dto).sort()).toEqual([
			'createdAt',
			'currency',
			'finalPriceMinor',
			'id',
			'paidAt',
			'plan',
			'status'
		]);
	});

	it('leaves the payment processor ids on the server', () => {
		const dto = toOrderDTO(
			makeOrder({ providerPaymentIntentId: 'pi_secret', providerSessionId: 'cs_secret' })
		);

		// Serialised, because a nested object would hide a leak from a key check.
		expect(JSON.stringify(dto)).not.toContain('pi_secret');
		expect(JSON.stringify(dto)).not.toContain('cs_secret');
	});

	it('reports the snapshot of what was sold, in epoch milliseconds', () => {
		const row = makeOrder({ paidAt: new Date('2026-07-18T09:00:00Z') });

		expect(toOrderDTO(row)).toEqual({
			id: row.id,
			plan: row.planSnapshot,
			status: 'pending',
			finalPriceMinor: 800,
			currency: 'usd',
			createdAt: row.createdAt.getTime(),
			paidAt: Date.parse('2026-07-18T09:00:00Z')
		});
	});

	it('says an unpaid order has no payment time', () => {
		expect(toOrderDTO(makeOrder({ paidAt: null })).paidAt).toBeNull();
	});

	it('refuses to launder a currency the app cannot price in', () => {
		// The column is free text (tech.md 5) while the DTO wants the frozen union. A cast here would
		// put a value into the type system that Money and MIN_CHARGE_MINOR know nothing about.
		expect(() => toOrderDTO(makeOrder({ currency: 'jpy' }))).toThrow(ConfigError);
	});
});
