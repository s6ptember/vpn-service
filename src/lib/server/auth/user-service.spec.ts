import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { users } from '../db/schema';
import type { TelegramProfile } from './init-data';
import { UserService } from './user-service';

/**
 * Derived from tech.md 9, step 4: "upsert users by telegramId, refresh username, firstName,
 * lastName and photoUrl on every login — people change them". The failure this pins down is the
 * one that matters: a second login must update the account, never fork a second one.
 */

const FIRST_LOGIN_MS = 1_700_000_000_000;
const SECOND_LOGIN_MS = FIRST_LOGIN_MS + 60 * 60 * 1000;

const profile = (overrides: Partial<TelegramProfile> = {}): TelegramProfile => ({
	telegramId: 555_000_111,
	firstName: 'Александр',
	lastName: 'Ким',
	username: 'alex_k',
	photoUrl: 'https://t.me/i/userpic/320/alex_k.jpg',
	languageCode: 'ru',
	...overrides
});

let db: Db;
let now: number;

const service = () => new UserService(db, { now: () => now });

beforeEach(() => {
	now = FIRST_LOGIN_MS;
	db = createDb(':memory:');
	// The real DDL, so a drift in schema.ts breaks this file rather than production.
	const ddl = readFileSync('./drizzle/0000_init.sql', 'utf8');
	for (const statement of ddl.split('--> statement-breakpoint')) {
		const sql = statement.trim();
		if (sql) db.run(sql as never);
	}
});

describe('UserService.upsertFromTelegram', () => {
	it('creates the account on first sight', () => {
		const row = service().upsertFromTelegram(profile());

		expect(row.id).toBeGreaterThan(0);
		expect(row.telegramId).toBe(555_000_111);
		expect(row.firstName).toBe('Александр');
		expect(row.username).toBe('alex_k');
		expect(row.isBlocked).toBe(false);
		expect(row.createdAt.getTime()).toBe(FIRST_LOGIN_MS);
	});

	it('keeps one row per telegramId across logins', () => {
		const first = service().upsertFromTelegram(profile());
		now = SECOND_LOGIN_MS;
		const second = service().upsertFromTelegram(profile());

		expect(second.id).toBe(first.id);
		expect(db.select().from(users).all()).toHaveLength(1);
	});

	it('refreshes the profile people actually change', () => {
		service().upsertFromTelegram(profile());
		now = SECOND_LOGIN_MS;

		const row = service().upsertFromTelegram(
			profile({
				firstName: 'Саша',
				lastName: 'Ким-Петров',
				username: 'sasha_k',
				photoUrl: 'https://t.me/i/userpic/320/new.jpg',
				languageCode: 'en'
			})
		);

		expect(row.firstName).toBe('Саша');
		expect(row.lastName).toBe('Ким-Петров');
		expect(row.username).toBe('sasha_k');
		expect(row.photoUrl).toBe('https://t.me/i/userpic/320/new.jpg');
		expect(row.languageCode).toBe('en');
	});

	it('clears a username and a photo the person removed', () => {
		service().upsertFromTelegram(profile());
		now = SECOND_LOGIN_MS;

		const row = service().upsertFromTelegram(profile({ username: null, photoUrl: null }));

		expect(row.username).toBeNull();
		expect(row.photoUrl).toBeNull();
	});

	it('preserves createdAt and moves updatedAt', () => {
		service().upsertFromTelegram(profile());
		now = SECOND_LOGIN_MS;
		const row = service().upsertFromTelegram(profile());

		expect(row.createdAt.getTime()).toBe(FIRST_LOGIN_MS);
		expect(row.updatedAt.getTime()).toBe(SECOND_LOGIN_MS);
	});

	it('does not unblock somebody by having them sign in again', () => {
		const created = service().upsertFromTelegram(profile());
		db.update(users).set({ isBlocked: true }).where(eq(users.id, created.id)).run();

		now = SECOND_LOGIN_MS;
		const row = service().upsertFromTelegram(profile({ firstName: 'Другое имя' }));

		expect(row.isBlocked).toBe(true);
		expect(row.firstName).toBe('Другое имя');
	});

	it('keeps the stripe customer attached across logins', () => {
		// Losing it would orphan the customer in Stripe and bill the next order to a new one.
		const created = service().upsertFromTelegram(profile());
		db.update(users).set({ stripeCustomerId: 'cus_123' }).where(eq(users.id, created.id)).run();

		now = SECOND_LOGIN_MS;
		expect(service().upsertFromTelegram(profile()).stripeCustomerId).toBe('cus_123');
	});

	it('keeps two different telegram accounts apart', () => {
		const one = service().upsertFromTelegram(profile());
		const two = service().upsertFromTelegram(profile({ telegramId: 555_000_222 }));

		expect(two.id).not.toBe(one.id);
		expect(db.select().from(users).all()).toHaveLength(2);
	});
});
