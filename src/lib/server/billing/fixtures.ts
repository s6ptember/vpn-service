import type { Db } from '../db/client';
import { plans, users, type PlanRow, type UserRow } from '../db/schema';

/**
 * Rows the billing and provisioning specs start from. Shared so every one of them describes the
 * same shop: one person, the seeded 30-day plan, real tables behind a real migration.
 */

export const SEED_TIME = new Date(1_784_000_000_000);

export function addUser(db: Db, overrides: Partial<UserRow> = {}): UserRow {
	return db
		.insert(users)
		.values({
			telegramId: 700_000_111,
			username: 'alex_k',
			firstName: 'Александр',
			lastName: 'Ким',
			photoUrl: null,
			languageCode: 'ru',
			createdAt: SEED_TIME,
			updatedAt: SEED_TIME,
			...overrides
		})
		.returning()
		.get();
}

export function addPlan(db: Db, overrides: Partial<PlanRow> = {}): PlanRow {
	return db
		.insert(plans)
		.values({
			name: '30 дней',
			description: 'Обычный выбор',
			durationDays: 30,
			priceMinor: 499,
			currency: 'usd',
			trafficLimitBytes: 0,
			isActive: true,
			sortOrder: 1,
			archivedAt: null,
			createdAt: SEED_TIME,
			updatedAt: SEED_TIME,
			...overrides
		})
		.returning()
		.get();
}
