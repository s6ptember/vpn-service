import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PriceQuote } from '$lib/types';
import type { Db } from '../db/client';
import {
	promoCodes,
	promoRedemptions,
	type PlanRow,
	type PromoCodeRow,
	type UserRow
} from '../db/schema';
import { createTestDb, TestClock } from '../jobs/fixtures';
import { addPlan, addUser } from './fixtures';
import { OrderService } from './order-service';
import { PromoService } from './promo-service';
import { PromoValidator } from './promo-validator';

/**
 * A10's acceptance criteria, not the class's code: tech.md 10 says the check and the increment share
 * one transaction with the redemption row, tech.md 6 makes redeeming an effect of a job that is
 * retried, and CLAUDE.md 3 demands that two runs leave exactly one effect. Real SQLite with the real
 * migrations, because every rule here is a unique index or a WHERE clause.
 */

let db: Db;
let clock: TestClock;
let orders: OrderService;
let promos: PromoService;
let user: UserRow;
let plan: PlanRow;

const QUOTE: PriceQuote = {
	basePriceMinor: 499,
	discountMinor: 149,
	finalPriceMinor: 350,
	currency: 'usd',
	promoCode: 'START30'
};

function addPromo(overrides: Partial<PromoCodeRow> = {}): PromoCodeRow {
	return db
		.insert(promoCodes)
		.values({
			code: 'START30',
			discountType: 'percent',
			discountValue: 30,
			maxUses: null,
			usedCount: 0,
			validFrom: null,
			validUntil: null,
			isActive: true,
			createdAt: new Date(clock.now()),
			archivedAt: null,
			...overrides
		})
		.returning()
		.get();
}

/** An order quoted with the code, left in whatever state the case is about. */
function addOrder(promoId: number | null, status: 'pending' | 'paid' | 'failed' = 'pending') {
	const order = orders.create({
		userId: user.id,
		planId: plan.id,
		plan: {
			name: plan.name,
			durationDays: plan.durationDays,
			priceMinor: plan.priceMinor,
			currency: 'usd',
			trafficLimitBytes: 0
		},
		quote: QUOTE,
		provider: 'fake',
		promoCodeId: promoId
	});

	if (status === 'paid') {
		orders.markPaid({
			orderId: order.id,
			paymentIntentId: `pi_${order.id}`,
			sessionId: `cs_${order.id}`
		});
	}
	if (status === 'failed') orders.settle(order.id, 'failed');

	return order;
}

const usedCount = (id: number) =>
	db.select().from(promoCodes).where(eq(promoCodes.id, id)).get()!.usedCount;

const redemptions = () => db.select().from(promoRedemptions).all();

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock();
	orders = new OrderService(db, { now: clock.now });
	promos = new PromoService(db, new PromoValidator(), orders, { now: clock.now });
	user = addUser(db);
	plan = addPlan(db);
});

describe('PromoService.resolve', () => {
	it('accepts a live code the person has never used', () => {
		const promo = addPromo();

		expect(promos.resolve('START30', user.id)).toEqual({
			ok: true,
			value: { id: promo.id, code: 'START30', discountType: 'percent', discountValue: 30 }
		});
	});

	it('finds a code however it was typed', () => {
		// tech.md 5 stores codes UPPERCASE; nobody types them that way on a phone.
		addPromo();

		expect(promos.resolve('  start30  ', user.id).ok).toBe(true);
	});

	it('refuses a code this person has already redeemed', () => {
		const promo = addPromo();
		const order = addOrder(promo.id, 'paid');
		promos.redeem({ promoCodeId: promo.id, userId: user.id, orderId: order.id });

		expect(promos.resolve('START30', user.id)).toEqual({ ok: false, error: 'already_used' });
	});

	it('refuses a second checkout while the first order is still on the payment page', () => {
		/**
		 * The window A10 has to close: no redemption row exists until the provision job runs, so
		 * without counting the open order somebody could hold two payment pages and pay both — two
		 * discounts, one of them given away.
		 */
		const promo = addPromo();
		addOrder(promo.id, 'pending');

		expect(promos.resolve('START30', user.id)).toEqual({ ok: false, error: 'already_used' });
	});

	it('refuses a second checkout while the first is paid and the key is still being made', () => {
		// Paid and unprovisioned is the same claim on the code, and it never drains.
		const promo = addPromo();
		addOrder(promo.id, 'paid');

		expect(promos.resolve('START30', user.id)).toEqual({ ok: false, error: 'already_used' });
	});

	it('frees the code again once an abandoned order is settled', () => {
		// Stripe expires the session after 30 minutes and the webhook writes `failed` (tech.md 10).
		const promo = addPromo();
		addOrder(promo.id, 'failed');

		expect(promos.resolve('START30', user.id).ok).toBe(true);
	});

	it('counts only this person', () => {
		const promo = addPromo();
		const other = addUser(db, { telegramId: 700_000_222 });
		const order = addOrder(promo.id, 'paid');
		promos.redeem({ promoCodeId: promo.id, userId: user.id, orderId: order.id });

		expect(promos.resolve('START30', other.id).ok).toBe(true);
	});

	it('refuses a code that is spent shop-wide', () => {
		addPromo({ maxUses: 2, usedCount: 2 });

		expect(promos.resolve('START30', user.id)).toEqual({ ok: false, error: 'exhausted' });
	});

	it('refuses a code nobody minted', () => {
		expect(promos.resolve('NOSUCHCODE', user.id)).toEqual({ ok: false, error: 'not_found' });
	});
});

describe('PromoService.redeem', () => {
	it('writes one redemption and moves the counter once', () => {
		const promo = addPromo();
		const order = addOrder(promo.id, 'paid');

		expect(promos.redeem({ promoCodeId: promo.id, userId: user.id, orderId: order.id })).toBe(
			'redeemed'
		);
		expect(usedCount(promo.id)).toBe(1);
		expect(redemptions()).toHaveLength(1);
	});

	it('is idempotent: the retried job changes nothing', () => {
		/**
		 * tech.md 6 requires it of every handler, and this one really is run twice — a failed attempt
		 * is retried, and the worker re-runs a job a dying process left `running`. A second increment
		 * here would burn a use of the code on every retry.
		 */
		const promo = addPromo({ maxUses: 10 });
		const order = addOrder(promo.id, 'paid');

		const first = promos.redeem({ promoCodeId: promo.id, userId: user.id, orderId: order.id });
		const second = promos.redeem({ promoCodeId: promo.id, userId: user.id, orderId: order.id });

		expect([first, second]).toEqual(['redeemed', 'already_redeemed']);
		expect(usedCount(promo.id)).toBe(1);
		expect(redemptions()).toHaveLength(1);
	});

	it('refuses a second order by the same person and leaves the counter alone', () => {
		// promo_once_per_user, at the level of the database rather than of good intentions (tech.md 10).
		const promo = addPromo();
		const first = addOrder(promo.id, 'paid');
		const second = addOrder(promo.id, 'paid');

		promos.redeem({ promoCodeId: promo.id, userId: user.id, orderId: first.id });

		expect(promos.redeem({ promoCodeId: promo.id, userId: user.id, orderId: second.id })).toBe(
			'already_redeemed'
		);
		expect(usedCount(promo.id)).toBe(1);
		expect(redemptions()).toHaveLength(1);
	});

	it('reports an overspend and writes nothing when the last use went to somebody else', () => {
		/**
		 * The race the WHERE clause on the increment exists for: this person was quoted the discount,
		 * walked to the payment page, and somebody else took the last use before they paid. The
		 * counter must not climb past maxUses, and the redemption row must not survive uncounted.
		 */
		const promo = addPromo({ maxUses: 1, usedCount: 1 });
		const order = addOrder(promo.id, 'paid');

		expect(promos.redeem({ promoCodeId: promo.id, userId: user.id, orderId: order.id })).toBe(
			'exhausted'
		);
		expect(usedCount(promo.id)).toBe(1);
		expect(redemptions()).toEqual([]);
	});

	it('spends the last use when it is still there', () => {
		const promo = addPromo({ maxUses: 3, usedCount: 2 });
		const order = addOrder(promo.id, 'paid');

		expect(promos.redeem({ promoCodeId: promo.id, userId: user.id, orderId: order.id })).toBe(
			'redeemed'
		);
		expect(usedCount(promo.id)).toBe(3);
	});
});

/**
 * A11. The criteria are tech.md 11 («CRUD промокодов») and tech.md 5: deletes are soft, because
 * promoRedemptions and orders point at these rows.
 */
describe('PromoService admin CRUD', () => {
	const input = {
		code: 'SUMMER',
		discountType: 'fixed' as const,
		discountValue: 200,
		maxUses: 100,
		validFrom: null,
		validUntil: null,
		isActive: true
	};

	it('creates a code the shop can immediately sell with', () => {
		const created = promos.create(input);

		expect(created.ok && created.value.usedCount).toBe(0);
		expect(promos.resolve('SUMMER', user.id).ok).toBe(true);
	});

	it('refuses a code somebody already minted', () => {
		// `code` is unique (tech.md 5); two campaigns reaching for one obvious name is not a 500.
		addPromo({ code: 'SUMMER' });

		expect(promos.create(input)).toEqual({ ok: false, error: 'code_taken' });
	});

	it('never lets an edit rewrite what has already been spent', () => {
		/**
		 * `usedCount` is the ledger `maxUses` is compared against. A form that could set it would let
		 * an admin hand a spent campaign back to customers without meaning to.
		 */
		const promo = addPromo({ maxUses: 10, usedCount: 4 });

		const updated = promos.update(promo.id, { ...input, code: 'START30' });

		expect(updated.ok && updated.value.usedCount).toBe(4);
	});

	it('lets an edit retire a code by lowering the limit under what is spent', () => {
		const promo = addPromo({ maxUses: 10, usedCount: 4 });

		promos.update(promo.id, { ...input, code: 'START30', maxUses: 4 });

		expect(promos.resolve('START30', user.id)).toEqual({ ok: false, error: 'exhausted' });
	});

	it('refuses to rename a code onto one that is taken', () => {
		addPromo({ code: 'SUMMER' });
		const other = addPromo({ code: 'START30' });

		expect(promos.update(other.id, input)).toEqual({ ok: false, error: 'code_taken' });
	});

	it('lets an edit keep its own code', () => {
		// The uniqueness check must not see the row's own code as a clash with itself.
		const promo = addPromo({ code: 'SUMMER' });

		expect(promos.update(promo.id, { ...input, discountValue: 300 }).ok).toBe(true);
	});

	it('archives instead of deleting, and stops the code working', () => {
		const promo = addPromo();

		expect(promos.archive(promo.id).ok).toBe(true);
		// The row survives — orders reference it — and refuses every customer from now on.
		expect(promos.findByCode('START30')).not.toBeNull();
		expect(promos.resolve('START30', user.id)).toEqual({ ok: false, error: 'inactive' });
	});

	it('refuses to edit an archived code', () => {
		// Archiving is the delete path and must be final: an edit would put a retired code back.
		const promo = addPromo();
		promos.archive(promo.id);

		expect(promos.update(promo.id, { ...input, code: 'START30' })).toEqual({
			ok: false,
			error: 'archived'
		});
	});

	it('archives idempotently, so a double-submitted form rewrites no history', () => {
		const promo = addPromo();
		const first = promos.archive(promo.id);
		const second = promos.archive(promo.id);

		expect(first).toEqual(second);
	});

	it('keeps archived codes out of the admin list and switched-off ones in it', () => {
		const live = addPromo({ code: 'LIVE' });
		addPromo({ code: 'HIDDEN', isActive: false });
		const retired = addPromo({ code: 'RETIRED' });
		promos.archive(retired.id);

		const listed = promos.listEditable().map((promo) => promo.code);

		expect(listed).toContain('HIDDEN');
		expect(listed).not.toContain('RETIRED');
		expect(listed).toContain(live.code);
	});
});
