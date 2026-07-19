import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuthError, ValidationError } from '../errors';
import { InitDataValidator } from './init-data';

/**
 * Derived from tech.md 9, not from the implementation. The contract this file pins:
 * a payload signed with our bot token passes, anything else does not, `signature` stays inside the
 * check string, and initData older than INIT_DATA_MAX_AGE_SEC is refused.
 *
 * The signer below is written from Telegram's published algorithm rather than reused from
 * init-data.ts — a test that signs with the code it verifies proves only that the code agrees
 * with itself.
 */

const BOT_TOKEN = '123456:AA-real-looking-but-fake-bot-token';
const NOW_MS = 1_700_000_000_000;
const AUTH_DATE_SEC = Math.floor(NOW_MS / 1000);
const MAX_AGE_SEC = 86_400;

const USER = {
	id: 555_000_111,
	first_name: 'Александр',
	last_name: 'Ким',
	username: 'alex_k',
	photo_url: 'https://t.me/i/userpic/320/alex_k.jpg',
	language_code: 'ru',
	is_premium: true
};

/** Telegram's own algorithm: sort by key, join `k=v` with newlines, HMAC under the WebAppData key. */
function sign(fields: Record<string, string>, botToken = BOT_TOKEN): string {
	const dataCheckString = Object.keys(fields)
		.sort()
		.map((key) => `${key}=${fields[key]}`)
		.join('\n');
	const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
	return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

/** Builds a raw initData string exactly as the client hands it over: percent-encoded, hash last. */
function initData(
	overrides: Record<string, string> = {},
	options: { botToken?: string; omitHash?: boolean } = {}
): string {
	const fields: Record<string, string> = {
		query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
		user: JSON.stringify(USER),
		auth_date: String(AUTH_DATE_SEC),
		...overrides
	};

	const params = new URLSearchParams(fields);
	if (!options.omitHash) params.set('hash', sign(fields, options.botToken));
	return params.toString();
}

const validator = (maxAgeSec = MAX_AGE_SEC) =>
	new InitDataValidator({ botToken: BOT_TOKEN, maxAgeSec, now: () => NOW_MS });

describe('InitDataValidator', () => {
	it('accepts a payload signed with our bot token and maps the profile', () => {
		const result = validator().validate(initData());

		expect(result.profile).toEqual({
			telegramId: USER.id,
			firstName: 'Александр',
			lastName: 'Ким',
			username: 'alex_k',
			photoUrl: USER.photo_url,
			languageCode: 'ru'
		});
		expect(result.authDateSec).toBe(AUTH_DATE_SEC);
		expect(result.startParam).toBeNull();
	});

	it('reads start_param, the deep link the payment return rides on', () => {
		const result = validator().validate(initData({ start_param: 'order_abc123' }));
		expect(result.startParam).toBe('order_abc123');
	});

	it('keeps the signature field inside the check string', () => {
		// Telegram's algorithm removes `hash` and nothing else. Dropping `signature` too would fail
		// every login from a client that sends it, and only from those clients.
		const raw = initData({ signature: 'ed25519-signature-value' });
		expect(() => validator().validate(raw)).not.toThrow();
	});

	it('refuses a payload whose fields were edited after signing', () => {
		const raw = initData();
		const tampered = raw.replace(
			encodeURIComponent(String(USER.id)),
			encodeURIComponent('999000111')
		);

		expect(tampered).not.toBe(raw);
		expect(() => validator().validate(tampered)).toThrow(AuthError);
	});

	it('refuses a payload signed with a different bot token', () => {
		const raw = initData({}, { botToken: '999999:someone-elses-token' });
		expect(() => validator().validate(raw)).toThrow(
			expect.objectContaining({ code: 'auth_bad_signature' })
		);
	});

	it('refuses a payload with no hash at all', () => {
		expect(() => validator().validate(initData({}, { omitHash: true }))).toThrow(AuthError);
	});

	it('refuses a hash of the wrong length without throwing on the constant-time compare', () => {
		// timingSafeEqual throws on differing lengths; a truncated hash must come back as a refusal.
		const raw = new URLSearchParams(initData());
		raw.set('hash', 'abc123');

		expect(() => validator().validate(raw.toString())).toThrow(
			expect.objectContaining({ code: 'auth_bad_signature' })
		);
	});

	it('refuses initData older than the configured max age', () => {
		const stale = String(AUTH_DATE_SEC - MAX_AGE_SEC - 1);
		expect(() => validator().validate(initData({ auth_date: stale }))).toThrow(
			expect.objectContaining({ code: 'auth_expired_init_data' })
		);
	});

	it('accepts initData that is exactly at the max age', () => {
		const edge = String(AUTH_DATE_SEC - MAX_AGE_SEC);
		expect(() => validator().validate(initData({ auth_date: edge }))).not.toThrow();
	});

	it('accepts an auth_date slightly in the future, since only our token can mint one', () => {
		const ahead = String(AUTH_DATE_SEC + 120);
		expect(() => validator().validate(initData({ auth_date: ahead }))).not.toThrow();
	});

	it('checks the signature before the clock', () => {
		// Otherwise a forged payload with a fresh auth_date would be told which half it failed.
		const raw = initData({ auth_date: '1' }, { botToken: 'nope' });
		expect(() => validator().validate(raw)).toThrow(
			expect.objectContaining({ code: 'auth_bad_signature' })
		);
	});

	it('survives a photo_url carrying escaped slashes, the classic rebuild trap', () => {
		// A client that JSON-escapes the URL still signs the raw string; validating the raw string is
		// what makes that survive. Rebuilding from a parsed object would drop the backslashes here.
		const escaped = `{"id":${USER.id},"first_name":"Алекс","photo_url":"https:\\/\\/t.me\\/i\\/userpic\\/320\\/a.jpg"}`;
		const result = validator().validate(initData({ user: escaped }));

		expect(result.profile.photoUrl).toBe('https://t.me/i/userpic/320/a.jpg');
	});

	it('stores absent optional fields as null rather than empty strings', () => {
		const minimal = JSON.stringify({ id: 42, first_name: 'Ким' });
		const result = validator().validate(initData({ user: minimal }));

		expect(result.profile).toEqual({
			telegramId: 42,
			firstName: 'Ким',
			lastName: null,
			username: null,
			photoUrl: null,
			languageCode: null
		});
	});

	it('drops a photo_url that is not an https URL instead of refusing the login', () => {
		const hostile = JSON.stringify({
			id: 42,
			first_name: 'Ким',
			photo_url: 'javascript:alert(1)'
		});
		const result = validator().validate(initData({ user: hostile }));

		expect(result.profile.photoUrl).toBeNull();
	});

	it('rejects a signed payload with no user, which no upsert could use', () => {
		const raw = new URLSearchParams(initData());
		raw.delete('user');
		raw.delete('hash');
		const fields = Object.fromEntries(raw.entries());
		raw.set('hash', sign(fields));

		expect(() => validator().validate(raw.toString())).toThrow(ValidationError);
	});

	it('rejects a signed user object that cannot fill the columns', () => {
		const raw = initData({ user: JSON.stringify({ id: 0, first_name: '' }) });
		expect(() => validator().validate(raw)).toThrow(ValidationError);
	});

	it('rejects a signed auth_date that is not a timestamp', () => {
		expect(() => validator().validate(initData({ auth_date: 'вчера' }))).toThrow(ValidationError);
	});

	it('never puts initData or the bot token into the error it throws', () => {
		// CLAUDE.md 2: initData and tokens must not reach a log line, and errors are logged whole.
		try {
			validator().validate(initData({}, { botToken: 'wrong' }));
			expect.unreachable('validate must throw on a bad signature');
		} catch (err) {
			const text = `${(err as Error).message} ${(err as Error).stack}`;
			expect(text).not.toContain(BOT_TOKEN);
			expect(text).not.toContain('auth_date=');
		}
	});
});
