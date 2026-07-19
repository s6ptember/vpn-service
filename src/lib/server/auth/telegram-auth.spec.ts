import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { users } from '../db/schema';
import { RateLimiter } from '../rate-limit';
import { InitDataValidator } from './init-data';
import { TelegramAuthService } from './telegram-auth';
import { UserService } from './user-service';

/**
 * The seam A1 promises: a signed payload becomes an account, an unsigned one becomes nothing, a
 * blocked account never becomes a session, and a stranger cannot spend more than CLAUDE.md 2's ten
 * attempts a minute. Assembled from the real classes — the point is that they agree with each
 * other, which a mock of the validator would hide.
 */

const BOT_TOKEN = '123456:AA-real-looking-but-fake-bot-token';
const NOW_MS = 1_700_000_000_000;
const IP = '203.0.113.7';

function initData(user: Record<string, unknown>, botToken = BOT_TOKEN): string {
	const fields: Record<string, string> = {
		user: JSON.stringify(user),
		auth_date: String(Math.floor(NOW_MS / 1000))
	};
	const dataCheckString = Object.keys(fields)
		.sort()
		.map((key) => `${key}=${fields[key]}`)
		.join('\n');
	const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();

	const params = new URLSearchParams(fields);
	params.set('hash', createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
	return params.toString();
}

const ALEX = { id: 555_000_111, first_name: 'Александр', username: 'alex_k' };

let db: Db;
let now: number;

function service(limit = 10) {
	const clock = () => now;
	return new TelegramAuthService(
		new InitDataValidator({ botToken: BOT_TOKEN, maxAgeSec: 86_400, now: clock }),
		new UserService(db, { now: clock }),
		new RateLimiter({ limit, windowMs: 60_000, now: clock })
	);
}

beforeEach(() => {
	now = NOW_MS;
	db = createDb(':memory:');
	const ddl = readFileSync('./drizzle/0000_init.sql', 'utf8');
	for (const statement of ddl.split('--> statement-breakpoint')) {
		const sql = statement.trim();
		if (sql) db.run(sql as never);
	}
});

describe('TelegramAuthService.exchange', () => {
	it('turns a signed payload into a stored account', () => {
		const user = service().exchange(initData(ALEX), IP);

		expect(user.telegramId).toBe(ALEX.id);
		expect(user.username).toBe('alex_k');
		expect(db.select().from(users).all()).toHaveLength(1);
	});

	it('signs the same person in twice without forking the account', () => {
		const auth = service();
		const first = auth.exchange(initData(ALEX), IP);
		const second = auth.exchange(initData({ ...ALEX, first_name: 'Саша' }), IP);

		expect(second.id).toBe(first.id);
		expect(second.firstName).toBe('Саша');
	});

	it('writes nothing when the signature does not hold', () => {
		expect(() => service().exchange(initData(ALEX, 'someone-elses-token'), IP)).toThrow(
			expect.objectContaining({ code: 'auth_bad_signature' })
		);
		expect(db.select().from(users).all()).toHaveLength(0);
	});

	it('refuses a blocked account instead of handing it a session', () => {
		const auth = service();
		const created = auth.exchange(initData(ALEX), IP);
		db.update(users).set({ isBlocked: true }).where(eq(users.id, created.id)).run();

		expect(() => auth.exchange(initData(ALEX), IP)).toThrow(
			expect.objectContaining({ code: 'auth_blocked' })
		);
	});

	it('caps refused attempts per IP and says when to come back', () => {
		const auth = service(3);
		const bad = initData(ALEX, 'someone-elses-token');

		for (let attempt = 1; attempt <= 3; attempt++) {
			expect(() => auth.exchange(bad, IP)).toThrow(
				expect.objectContaining({ code: 'auth_bad_signature' })
			);
		}

		// The fourth is stopped before the HMAC runs: past the budget, a stranger orders no work.
		expect(() => auth.exchange(bad, IP)).toThrow(
			expect.objectContaining({ code: 'rate_limit', retryAfterSec: 60 })
		);
	});

	it('does not charge the budget for a login that proves it holds our HMAC', () => {
		// Several people share one source address behind a proxy, on carrier NAT and in an office.
		// Charging valid logins would turn the abuse limit into an outage for all of them.
		const auth = service(2);

		for (let attempt = 1; attempt <= 5; attempt++) {
			expect(() => auth.exchange(initData(ALEX), IP)).not.toThrow();
		}
	});

	it('counts a blocked account against the budget, since it proves nothing about intent', () => {
		const auth = service(1);
		const created = auth.exchange(initData(ALEX), IP);
		db.update(users).set({ isBlocked: true }).where(eq(users.id, created.id)).run();

		expect(() => auth.exchange(initData(ALEX), IP)).toThrow(
			expect.objectContaining({ code: 'auth_blocked' })
		);
		expect(() => auth.exchange(initData(ALEX), IP)).toThrow(
			expect.objectContaining({ code: 'rate_limit' })
		);
	});

	it('does not let one flooded IP block a different person', () => {
		const auth = service(1);
		const bad = initData(ALEX, 'someone-elses-token');

		expect(() => auth.exchange(bad, IP)).toThrow(
			expect.objectContaining({ code: 'auth_bad_signature' })
		);
		expect(() => auth.exchange(bad, IP)).toThrow(expect.objectContaining({ code: 'rate_limit' }));

		expect(() => auth.exchange(bad, '198.51.100.9')).toThrow(
			expect.objectContaining({ code: 'auth_bad_signature' })
		);
	});
});
