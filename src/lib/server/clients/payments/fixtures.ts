import type { OrderRow, UserRow } from '$lib/server/db/schema';
import type { PlanSnapshot } from '$lib/types';

/** Rows the payments specs feed to the providers. Shared so both specs describe one order. */

export const PLAN_SNAPSHOT: PlanSnapshot = {
	name: 'VPN на 30 дней',
	durationDays: 30,
	priceMinor: 1000,
	currency: 'usd',
	trafficLimitBytes: 0
};

export function makeUser(overrides: Partial<UserRow> = {}): UserRow {
	return {
		id: 7,
		telegramId: 424242,
		username: 's6ptember',
		firstName: 'Ростик',
		lastName: null,
		photoUrl: null,
		languageCode: 'ru',
		stripeCustomerId: null,
		isBlocked: false,
		createdAt: new Date('2026-07-01T10:00:00Z'),
		updatedAt: new Date('2026-07-01T10:00:00Z'),
		...overrides
	};
}

/** Base 1000, promo took 200 off: the server-side quote is 800 and nothing else may charge. */
export function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
	return {
		id: 42,
		userId: 7,
		planId: 3,
		promoCodeId: null,
		planSnapshot: PLAN_SNAPSHOT,
		basePriceMinor: 1000,
		discountMinor: 200,
		finalPriceMinor: 800,
		currency: 'usd',
		status: 'pending',
		provider: 'stripe',
		publicId: 'ord_9aBcD',
		providerSessionId: null,
		providerPaymentIntentId: null,
		createdAt: new Date('2026-07-17T12:00:00Z'),
		paidAt: null,
		...overrides
	};
}
