import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { createDb, type Db } from '../db/client';
import { users } from '../db/schema';
import { SESSION_COOKIE, SessionService } from './session';

/**
 * Derived from tech.md 9, not from the implementation: the cookie must be unforgeable without the
 * secret, must expire, must not outlive a block, and isAdmin must equal
 * `user.telegramId === config.ADMIN_CHAT_ID`. The guard in hooks.server.ts consumes exactly this,
 * so anything it gets wrong is an auth bug.
 */

const SECRET = 'a'.repeat(64);
const OTHER_SECRET = 'b'.repeat(64);
const ADMIN_CHAT_ID = 100_000_001;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal Cookies stand-in: the service only ever get/set/deletes by name. */
function fakeCookies(initial: Record<string, string> = {}) {
	const jar = new Map(Object.entries(initial));
	return {
		jar,
		cookies: {
			get: (name: string) => jar.get(name),
			set: (name: string, value: string) => void jar.set(name, value),
			delete: (name: string) => void jar.delete(name)
		} as unknown as Cookies
	};
}

let db: Db;
let now: number;

function service(
	overrides: Partial<{ secret: string; ttlDays: number; adminChatId: number }> = {}
) {
	return new SessionService(db, {
		secret: overrides.secret ?? SECRET,
		ttlDays: overrides.ttlDays ?? 7,
		adminChatId: overrides.adminChatId ?? ADMIN_CHAT_ID,
		now: () => now
	});
}

function addUser(id: number, telegramId: number, isBlocked = false) {
	db.insert(users)
		.values({
			id,
			telegramId,
			firstName: 'Тест',
			username: null,
			lastName: null,
			photoUrl: null,
			languageCode: 'ru',
			isBlocked,
			createdAt: new Date(now),
			updatedAt: new Date(now)
		})
		.run();
}

beforeEach(() => {
	now = 1_700_000_000_000;
	db = createDb(':memory:');
	// Real schema, not a hand-written table: a drift in schema.ts must break these tests.
	const ddl = readFileSync('./drizzle/0000_init.sql', 'utf8');
	for (const statement of ddl.split('--> statement-breakpoint')) {
		const sql = statement.trim();
		if (sql) db.run(sql as never);
	}
});

describe('SessionService', () => {
	it('round-trips the user who was issued the cookie', () => {
		addUser(1, 555);
		const sessions = service();
		const { cookies, jar } = fakeCookies();

		sessions.issue(cookies, 1);
		expect(jar.get(SESSION_COOKIE)).toBeTruthy();

		expect(sessions.read(cookies)).toMatchObject({ id: 1, telegramId: 555 });
	});

	it('returns null when there is no cookie at all', () => {
		const { cookies } = fakeCookies();
		expect(service().read(cookies)).toBeNull();
	});

	describe('forgery', () => {
		it('rejects a token whose payload was edited to point at another user', () => {
			addUser(1, 555);
			addUser(2, 666);
			const sessions = service();
			const { cookies, jar } = fakeCookies();
			sessions.issue(cookies, 1);

			// Swap uid 1 -> 2 and keep the original signature.
			const [payload, signature] = jar.get(SESSION_COOKIE)!.split('.');
			const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
			claims.uid = 2;
			const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');
			jar.set(SESSION_COOKIE, `${forged}.${signature}`);

			expect(sessions.read(cookies)).toBeNull();
		});

		it('rejects a token signed with a different secret', () => {
			addUser(1, 555);
			const { cookies } = fakeCookies();
			service({ secret: OTHER_SECRET }).issue(cookies, 1);

			expect(service({ secret: SECRET }).read(cookies)).toBeNull();
		});

		it.each([
			['no signature', 'eyJ1aWQiOjF9'],
			['empty signature', 'eyJ1aWQiOjF9.'],
			['garbage', 'not-a-token'],
			['empty string', ''],
			['payload only, dot first', '.abc'],
			['unsigned payload with a plausible shape', 'eyJ1aWQiOjEsImV4cCI6OTk5OTk5OTk5OTk5OX0.x']
		])('rejects %s', (_label, token) => {
			addUser(1, 555);
			const { cookies } = fakeCookies({ [SESSION_COOKIE]: token });
			expect(service().read(cookies)).toBeNull();
		});
	});

	describe('expiry', () => {
		it('accepts the cookie inside its TTL', () => {
			addUser(1, 555);
			const sessions = service({ ttlDays: 7 });
			const { cookies } = fakeCookies();
			sessions.issue(cookies, 1);

			now += 6 * DAY_MS;
			expect(sessions.read(cookies)).not.toBeNull();
		});

		it('rejects the cookie once the TTL has passed', () => {
			addUser(1, 555);
			const sessions = service({ ttlDays: 7 });
			const { cookies } = fakeCookies();
			sessions.issue(cookies, 1);

			now += 8 * DAY_MS;
			expect(sessions.read(cookies)).toBeNull();
		});
	});

	it('treats a blocked user as signed out even with a valid cookie', () => {
		addUser(1, 555, true);
		const sessions = service();
		const { cookies } = fakeCookies();
		sessions.issue(cookies, 1);

		expect(sessions.read(cookies)).toBeNull();
	});

	it('returns null when the user behind a valid cookie is gone', () => {
		addUser(1, 555);
		const sessions = service();
		const { cookies } = fakeCookies();
		sessions.issue(cookies, 1);

		db.delete(users).run();
		expect(sessions.read(cookies)).toBeNull();
	});

	describe('isAdmin', () => {
		it('is true only for the telegramId in ADMIN_CHAT_ID', () => {
			addUser(1, ADMIN_CHAT_ID);
			addUser(2, 999);
			const sessions = service();

			const admin = fakeCookies();
			sessions.issue(admin.cookies, 1);
			expect(sessions.read(admin.cookies)?.isAdmin).toBe(true);

			const plain = fakeCookies();
			sessions.issue(plain.cookies, 2);
			expect(sessions.read(plain.cookies)?.isAdmin).toBe(false);
		});

		it('follows ADMIN_CHAT_ID rather than anything stored on the row', () => {
			// tech.md 5: the admin flag is never persisted, so moving the env var moves the admin.
			addUser(1, 555);
			const { cookies } = fakeCookies();
			service().issue(cookies, 1);

			expect(service({ adminChatId: 555 }).read(cookies)?.isAdmin).toBe(true);
			expect(service({ adminChatId: 777 }).read(cookies)?.isAdmin).toBe(false);
		});
	});

	it('sets a cookie Telegram can actually send back from its iframe', () => {
		// tech.md 9: 'lax' would drop the cookie on Telegram Desktop and Web, and 'none' forces secure.
		addUser(1, 555);
		const captured: { options?: Record<string, unknown> } = {};
		const cookies = {
			get: () => undefined,
			set: (_name: string, _value: string, options: Record<string, unknown>) => {
				captured.options = options;
			},
			delete: () => {}
		} as unknown as Cookies;

		service({ ttlDays: 7 }).issue(cookies, 1);

		expect(captured.options).toMatchObject({
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'none',
			maxAge: 7 * 24 * 60 * 60
		});
	});

	it('clears the cookie', () => {
		addUser(1, 555);
		const sessions = service();
		const { cookies, jar } = fakeCookies();
		sessions.issue(cookies, 1);

		sessions.clear(cookies);
		expect(jar.has(SESSION_COOKIE)).toBe(false);
		expect(sessions.read(cookies)).toBeNull();
	});
});
