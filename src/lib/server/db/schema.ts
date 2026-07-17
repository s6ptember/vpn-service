import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import type { PlanSnapshot } from '$lib/types';

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	telegramId: integer('telegram_id').notNull().unique(),
	username: text('username'),
	firstName: text('first_name').notNull(),
	lastName: text('last_name'),
	photoUrl: text('photo_url'),
	languageCode: text('language_code'),
	stripeCustomerId: text('stripe_customer_id').unique(), // created lazily, on first checkout
	isBlocked: integer('is_blocked', { mode: 'boolean' }).notNull().default(false),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull()
});

export const plans = sqliteTable('plans', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	description: text('description'),
	durationDays: integer('duration_days').notNull(), // 7 | 30 | 90, field itself is free
	priceMinor: integer('price_minor').notNull(), // cents, not below MIN_CHARGE_MINOR
	currency: text('currency', { enum: ['usd', 'eur'] }).notNull(),
	trafficLimitBytes: integer('traffic_limit_bytes').notNull().default(0), // 0 = unlimited
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: timestamp('created_at').notNull(),
	updatedAt: timestamp('updated_at').notNull(),
	archivedAt: timestamp('archived_at')
});

export const promoCodes = sqliteTable('promo_codes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	code: text('code').notNull().unique(), // stored UPPERCASE
	discountType: text('discount_type', { enum: ['percent', 'fixed'] }).notNull(),
	discountValue: integer('discount_value').notNull(), // percent: 1..100, fixed: minor units
	maxUses: integer('max_uses'), // null = unlimited
	usedCount: integer('used_count').notNull().default(0),
	validFrom: timestamp('valid_from'),
	validUntil: timestamp('valid_until'),
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
	createdAt: timestamp('created_at').notNull(),
	archivedAt: timestamp('archived_at')
});

export const orders = sqliteTable(
	'orders',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		planId: integer('plan_id')
			.notNull()
			.references(() => plans.id),
		promoCodeId: integer('promo_code_id').references(() => promoCodes.id),
		planSnapshot: text('plan_snapshot', { mode: 'json' }).$type<PlanSnapshot>().notNull(),
		basePriceMinor: integer('base_price_minor').notNull(),
		discountMinor: integer('discount_minor').notNull().default(0),
		finalPriceMinor: integer('final_price_minor').notNull(),
		currency: text('currency').notNull(),
		status: text('status', { enum: ['pending', 'paid', 'failed', 'canceled'] }).notNull(),
		provider: text('provider', { enum: ['stripe', 'fake'] }).notNull(),
		publicId: text('public_id').notNull().unique(), // nanoid, goes to client_reference_id and metadata.orderId
		providerSessionId: text('provider_session_id').unique(), // cs_…
		providerPaymentIntentId: text('provider_payment_intent_id').unique(), // pi_…, payment idempotency anchor
		createdAt: timestamp('created_at').notNull(),
		paidAt: timestamp('paid_at')
	},
	(t) => [index('orders_user_created_idx').on(t.userId, t.createdAt)]
);

export const webhookEvents = sqliteTable('webhook_events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	provider: text('provider', { enum: ['stripe', 'fake'] }).notNull(),
	eventId: text('event_id').notNull().unique(), // evt_…; Stripe retries and sends duplicates
	type: text('type').notNull(),
	receivedAt: timestamp('received_at').notNull()
});

export const promoRedemptions = sqliteTable(
	'promo_redemptions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		promoCodeId: integer('promo_code_id')
			.notNull()
			.references(() => promoCodes.id),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		orderId: integer('order_id')
			.notNull()
			.unique()
			.references(() => orders.id),
		createdAt: timestamp('created_at').notNull()
	},
	(t) => [unique('promo_once_per_user').on(t.promoCodeId, t.userId)]
);

export const subscriptions = sqliteTable(
	'subscriptions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.unique()
			.references(() => users.id), // exactly one per person
		planId: integer('plan_id')
			.notNull()
			.references(() => plans.id), // last purchased
		marzbanUsername: text('marzban_username').notNull().unique(), // tg_<telegramId>
		subscriptionUrl: text('subscription_url').notNull(),
		startsAt: timestamp('starts_at').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		status: text('status', { enum: ['active', 'expired', 'revoked'] }).notNull(),
		lastSyncedAt: timestamp('last_synced_at'),
		createdAt: timestamp('created_at').notNull(),
		updatedAt: timestamp('updated_at').notNull()
	},
	(t) => [index('subs_expires_idx').on(t.expiresAt)]
);

export const supportTickets = sqliteTable(
	'support_tickets',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		message: text('message').notNull(), // 10..2000 chars
		status: text('status', { enum: ['new', 'delivered', 'failed'] }).notNull(),
		adminMessageId: integer('admin_message_id'),
		createdAt: timestamp('created_at').notNull(),
		deliveredAt: timestamp('delivered_at')
	},
	(t) => [index('tickets_user_created_idx').on(t.userId, t.createdAt)]
);

export const faqItems = sqliteTable('faq_items', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	question: text('question').notNull(),
	answer: text('answer').notNull(),
	sortOrder: integer('sort_order').notNull().default(0),
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true)
});

export const jobs = sqliteTable(
	'jobs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		type: text('type').notNull(),
		payload: text('payload', { mode: 'json' }).notNull(),
		idempotencyKey: text('idempotency_key').notNull().unique(),
		status: text('status', { enum: ['pending', 'running', 'done', 'failed'] }).notNull(),
		attempts: integer('attempts').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(5),
		runAt: timestamp('run_at').notNull(),
		lockedAt: timestamp('locked_at'),
		lastError: text('last_error'),
		createdAt: timestamp('created_at').notNull(),
		updatedAt: timestamp('updated_at').notNull()
	},
	(t) => [index('jobs_status_runat_idx').on(t.status, t.runAt)]
);

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type PlanRow = typeof plans.$inferSelect;
export type PlanInsert = typeof plans.$inferInsert;
export type PromoCodeRow = typeof promoCodes.$inferSelect;
export type PromoCodeInsert = typeof promoCodes.$inferInsert;
export type OrderRow = typeof orders.$inferSelect;
export type OrderInsert = typeof orders.$inferInsert;
export type WebhookEventRow = typeof webhookEvents.$inferSelect;
export type PromoRedemptionRow = typeof promoRedemptions.$inferSelect;
export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type SubscriptionInsert = typeof subscriptions.$inferInsert;
export type SupportTicketRow = typeof supportTickets.$inferSelect;
export type SupportTicketInsert = typeof supportTickets.$inferInsert;
export type FaqItemRow = typeof faqItems.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type JobInsert = typeof jobs.$inferInsert;
