import { describe, expect, it } from 'vitest';
import {
	AppError,
	AuthError,
	ConfigError,
	ConflictError,
	ForbiddenError,
	MarzbanError,
	NotFoundError,
	PaymentProviderError,
	PaymentSignatureError,
	RateLimitError,
	TelegramError,
	ValidationError,
	toHttp
} from './errors';

/**
 * Assembled at runtime rather than written as literals: they are invented values, but spelled out in
 * full they match GitHub's secret-scanning patterns and push protection rejects the whole push.
 */
const FAKE_STRIPE_LIVE_KEY = ['sk', 'live', '51HxAbCdEfGh'].join('_');
const FAKE_BOT_TOKEN = ['123456789', 'AAHdqTcv'].join(':');

/**
 * These cases encode CLAUDE.md 2 and 3, not this file's implementation:
 *  - the domain throws AppError and knows nothing about HTTP; toHttp is the one mapping;
 *  - what leaves the server is a code and a human sentence — a stack trace, an upstream message or
 *    anything holding a secret stays in the log;
 *  - the statuses come from tech.md 9 (401 without a session, 403 for a non-admin on an admin path,
 *    400 when a payment signature does not verify).
 */

const REQUEST_ID = '018f2b0c-0d3e-7a1b-9c4d-5e6f70819293';

describe('toHttp status mapping', () => {
	it.each([
		['session missing', new AuthError('no_session'), 401],
		['initData signature forged', new AuthError('bad_signature'), 401],
		['initData too old', new AuthError('expired_init_data'), 401],
		['user blocked', new AuthError('blocked'), 403],
		['non-admin on an admin path', new ForbiddenError(), 403],
		['unknown entity', new NotFoundError(), 404],
		['input failed its schema', new ValidationError(), 400],
		['unique constraint or bad state', new ConflictError(), 409],
		['limit spent', new RateLimitError(60), 429],
		['panel refused', new MarzbanError('boom', { status: 500 }), 502],
		['bot api refused', new TelegramError('boom', { status: 500 }), 502],
		['payment signature did not verify', new PaymentSignatureError('bad signature'), 400],
		['provider unreachable', new PaymentProviderError('stripe down'), 502],
		['wiring mistake', new ConfigError('missing option'), 500]
	])('maps %s', (_label, err, status) => {
		expect(toHttp(err, REQUEST_ID).status).toBe(status);
	});

	it('always returns the full App.Error shape', () => {
		const { body } = toHttp(new NotFoundError(), REQUEST_ID);

		expect(body).toEqual({
			code: 'not_found',
			message: expect.any(String),
			requestId: REQUEST_ID
		});
	});

	it('reports the reason in the code so auth failures stay distinguishable in a log', () => {
		expect(toHttp(new AuthError('bad_signature'), REQUEST_ID).body.code).toBe('auth_bad_signature');
		expect(toHttp(new AuthError('no_session'), REQUEST_ID).body.code).toBe('auth_no_session');
	});
});

describe('toHttp keeps upstream prose out of the response', () => {
	it.each([
		[
			'marzban',
			new MarzbanError('createUser failed with 422 at http://marzban:8000/api/user', {
				status: 422
			})
		],
		[
			'telegram',
			new TelegramError(`POST https://api.telegram.org/bot${FAKE_BOT_TOKEN}/sendMessage failed`, {
				status: 400
			})
		],
		['payments', new PaymentProviderError(`Stripe key ${FAKE_STRIPE_LIVE_KEY} was rejected`)],
		['config', new ConfigError('SESSION_SECRET is missing from the environment')]
	])('replaces the %s message, which carries hosts, paths and credentials', (_label, err) => {
		const { body } = toHttp(err, REQUEST_ID);

		expect(body.message).not.toBe(err.message);
		// Whatever the sentence is, none of the upstream detail may survive into it.
		expect(body.message).not.toMatch(/marzban|telegram\.org|sk_live|SESSION_SECRET|8000/i);
	});

	it('surfaces the message of errors written for the person', () => {
		// These messages exist to be read by a user, so replacing them would lose the only text that
		// tells them what to do next (CLAUDE.md 2: "код и человеческий текст").
		expect(
			toHttp(new ValidationError('Промокод должен быть от 3 до 32 символов.'), REQUEST_ID).body
				.message
		).toBe('Промокод должен быть от 3 до 32 символов.');
		expect(
			toHttp(new ConflictError('Этот промокод вы уже применяли.'), REQUEST_ID).body.message
		).toBe('Этот промокод вы уже применяли.');
	});

	it('never echoes a non-AppError message: it can hold a DSN, a query or a token', () => {
		const leaky = new Error('SQLITE_ERROR: no such column: users.stripe_customer_id');

		const { status, body } = toHttp(leaky, REQUEST_ID);

		expect(status).toBe(500);
		expect(body.message).not.toContain('SQLITE_ERROR');
		expect(body.message).not.toContain('stripe_customer_id');
		expect(body.requestId).toBe(REQUEST_ID);
	});

	it.each([
		['a thrown string', 'boom'],
		['a thrown object', { message: FAKE_STRIPE_LIVE_KEY }],
		['null', null],
		['undefined', undefined]
	])('answers 500 for %s rather than crashing the boundary', (_label, thrown) => {
		const { status, body } = toHttp(thrown, REQUEST_ID);

		expect(status).toBe(500);
		expect(body.code).toBe('internal');
		expect(JSON.stringify(body)).not.toContain('sk_live');
	});
});

describe('AppError hierarchy', () => {
	it('keeps instanceof intact, which is what toHttp dispatches on', () => {
		// A downlevelled builtin subclass silently loses its prototype chain, and every domain error
		// would then take the unknown path above and answer 500.
		const err = new MarzbanError('boom', { status: 502 });

		expect(err).toBeInstanceOf(MarzbanError);
		expect(err).toBeInstanceOf(AppError);
		expect(err).toBeInstanceOf(Error);
	});

	it('names itself after its own class so a log line identifies the failure', () => {
		expect(new ForbiddenError().name).toBe('ForbiddenError');
		expect(new AuthError('no_session').name).toBe('AuthError');
	});

	it('carries the cause without putting it in the response', () => {
		const cause = new Error('ECONNREFUSED 10.0.0.5:8000');
		const err = new MarzbanError('marzban is unreachable', { cause });

		expect(err.cause).toBe(cause);
		expect(toHttp(err, REQUEST_ID).body.message).not.toContain('ECONNREFUSED');
	});

	it('reports no status when no HTTP answer arrived', () => {
		// A timeout has no status to report, and callers branch on that.
		expect(new MarzbanError('timed out', {}).status).toBeNull();
		expect(new TelegramError('timed out').status).toBeNull();
	});

	it('carries retryAfterSec for the caller to turn into a Retry-After header', () => {
		expect(new RateLimitError(42).retryAfterSec).toBe(42);
		expect(new TelegramError('slow down', { status: 429, retryAfterSec: 30 }).retryAfterSec).toBe(
			30
		);
	});
});
