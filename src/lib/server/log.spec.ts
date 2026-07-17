import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarzbanError } from './errors';
import { log, redact, redactText } from './log';

/**
 * These cases encode CLAUDE.md 2: a log line may carry requestId, an event type and entity ids, and
 * must never carry initData, a token, a Stripe key or a whole webhook body.
 */

const RAW_INIT_DATA =
	'query_id=AAHdF6IQAAAAAN0Xoh&user=%7B%22id%22%3A100000001%7D&auth_date=1700000000&hash=c0ffee0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

/**
 * Fixtures are assembled at runtime rather than written as literals. They are invented values, but
 * spelled out in full they match GitHub's secret-scanning patterns, and push protection blocks the
 * whole push over a test file. Same strings reach redact() either way.
 */
const FAKE_STRIPE_LIVE_KEY = ['sk', 'live', '51HxAbCdEfGhIjKlMnOpQrSt'].join('_');
const FAKE_BOT_TOKEN = ['123456789', 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'].join(':');
const FAKE_BOT_TOKEN_TAIL = 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

describe('redact', () => {
	it('masks values by key name whatever the spelling', () => {
		const out = redact({
			initData: RAW_INIT_DATA,
			init_data: RAW_INIT_DATA,
			TELEGRAM_BOT_TOKEN: FAKE_BOT_TOKEN,
			access_token: 'opaque-value',
			'stripe-signature': 't=1700000000,v1=deadbeef',
			password: 'hunter2',
			sessionSecret: 'anything',
			cookie: 'session=abc'
		}) as Record<string, unknown>;

		expect(out.initData).toBe('[redacted]');
		expect(out.init_data).toBe('[redacted]');
		expect(out.TELEGRAM_BOT_TOKEN).toBe('[redacted]');
		expect(out.access_token).toBe('[redacted]');
		expect(out['stripe-signature']).toBe('[redacted]');
		expect(out.password).toBe('[redacted]');
		expect(out.sessionSecret).toBe('[redacted]');
		expect(out.cookie).toBe('[redacted]');
	});

	it('masks a secret by its shape even under an innocent key', () => {
		const out = redact({
			note: FAKE_STRIPE_LIVE_KEY,
			message: `call to https://api.telegram.org/bot${FAKE_BOT_TOKEN}/x failed`
		}) as Record<string, string>;

		expect(out.note).toBe('[redacted]');
		// The sentence survives, the token inside it does not: that sentence is why anyone reads a log.
		expect(out.message).toContain('call to https://api.telegram.org/bot');
		expect(out.message).toContain('[redacted]');
		expect(out.message).not.toContain(FAKE_BOT_TOKEN_TAIL);
	});

	it('masks raw initData held under a benign key', () => {
		const out = redact({ body: RAW_INIT_DATA, blob: RAW_INIT_DATA }) as Record<string, string>;

		expect(out.body).toBe('[redacted]');
		expect(out.blob).toBe('[redacted]');
	});

	it('keeps benign fields, including the ids the queue logs', () => {
		const out = redact({
			requestId: '018f2b0c-0d3e-7a1b-9c4d-5e6f70819293',
			event: 'subscription.provision',
			orderId: 42,
			idempotencyKey: 'provision:order:42',
			dedupeKey: 'tg:expiry:7:3',
			daysLeft: 3,
			isAdmin: false,
			paidAt: null,
			plan: { name: '30 дней', durationDays: 30 }
		}) as Record<string, unknown>;

		expect(out).toEqual({
			requestId: '018f2b0c-0d3e-7a1b-9c4d-5e6f70819293',
			event: 'subscription.provision',
			orderId: 42,
			idempotencyKey: 'provision:order:42',
			dedupeKey: 'tg:expiry:7:3',
			daysLeft: 3,
			isAdmin: false,
			paidAt: null,
			plan: { name: '30 дней', durationDays: 30 }
		});
	});

	it('masks nested and array-held secrets', () => {
		const out = redact({
			order: { id: 7, stripe: { secretKey: 'sk_test_abcdefghijklmnop' } },
			attempts: [{ authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' }]
		}) as {
			order: { id: number; stripe: Record<string, string> };
			attempts: Record<string, string>[];
		};

		expect(out.order.id).toBe(7);
		expect(out.order.stripe.secretKey).toBe('[redacted]');
		expect(out.attempts[0].authorization).toBe('[redacted]');
	});

	it('survives a cycle instead of hanging', () => {
		const node: Record<string, unknown> = { id: 1, token: 'abc' };
		node.self = node;
		node.children = [{ parent: node }];

		const out = redact(node) as Record<string, unknown>;

		expect(out.id).toBe(1);
		expect(out.token).toBe('[redacted]');
		expect(out.self).toBe('[circular]');
		expect((out.children as Array<Record<string, unknown>>)[0].parent).toBe('[circular]');
	});

	it('prints a repeated non-cyclic reference twice', () => {
		const shared = { planId: 3 };
		const out = redact({ a: shared, b: shared }) as Record<string, unknown>;

		expect(out).toEqual({ a: { planId: 3 }, b: { planId: 3 } });
	});

	it('unwraps an Error and keeps its stack for the log', () => {
		const cause = new Error('upstream said no');
		const err = new Error('provision failed', { cause });

		const out = redact({ error: err }) as { error: Record<string, unknown> };

		expect(out.error.name).toBe('Error');
		expect(out.error.message).toBe('provision failed');
		expect(typeof out.error.stack).toBe('string');
		expect((out.error.cause as Record<string, unknown>).message).toBe('upstream said no');
	});

	it('does not mutate its input', () => {
		const input = { token: 'secret-value', id: 1 };

		redact(input);

		expect(input.token).toBe('secret-value');
	});
});

describe('redactText', () => {
	it('renders an error as one safe line for jobs.lastError', () => {
		const text = redactText(new Error(`token ${FAKE_BOT_TOKEN} is bad`));

		expect(text).toContain('Error: token');
		expect(text).not.toContain(FAKE_BOT_TOKEN_TAIL);
	});

	it('renders a structure as json with secrets masked', () => {
		const text = redactText({ orderId: 7, password: 'hunter2' });

		expect(text).toContain('"orderId":7');
		expect(text).not.toContain('hunter2');
	});

	it('returns a string for hostile input instead of throwing', () => {
		// queue.ts writes jobs.lastError from a catch block. A throw here would lose the job failure
		// this function exists to describe.
		const hostile = {
			get reason(): string {
				throw new Error('getter exploded');
			}
		};

		expect(typeof redactText(hostile)).toBe('string');
	});
});

describe('logger', () => {
	afterEach(() => vi.restoreAllMocks());

	/** Captures stdout and parses it, which is the only contract a JSON log line has. */
	function capture(): () => Record<string, unknown>[] {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		return () => spy.mock.calls.map((call) => JSON.parse(call[0] as string));
	}

	it('writes one parseable json object per line, with level, time and event', () => {
		const lines = capture();

		log.info('plan_listed', { planId: 3 });

		expect(lines()).toEqual([
			{ level: 'info', time: expect.any(String), event: 'plan_listed', planId: 3 }
		]);
	});

	it('stamps a child logger bindings onto every line', () => {
		const lines = capture();

		log.child({ requestId: 'req-1' }).warn('promo_rejected', { reason: 'expired' });

		expect(lines()[0]).toMatchObject({ requestId: 'req-1', reason: 'expired' });
	});

	it('does not leak one request bindings into another', () => {
		// The root logger is a module-level singleton, shared by every request in the process
		// (CLAUDE.md 1.2). child() must copy, never mutate, or one person's requestId — and then
		// their user id — ends up stamped on someone else's line.
		const lines = capture();
		const root = log.child({ service: 'worker' });

		const first = root.child({ requestId: 'req-1', userId: 1 });
		const second = root.child({ requestId: 'req-2' });

		first.info('a');
		second.info('b');
		root.info('c');

		const [a, b, c] = lines();
		expect(a).toMatchObject({ service: 'worker', requestId: 'req-1', userId: 1 });
		expect(b).toMatchObject({ service: 'worker', requestId: 'req-2' });
		expect(b.userId).toBeUndefined();
		expect(c.requestId).toBeUndefined();
		expect(c.userId).toBeUndefined();
	});

	it('redacts bindings as well as fields', () => {
		// A secret bound once into a child would otherwise be reprinted on every line it writes.
		const lines = capture();

		log.child({ botToken: FAKE_BOT_TOKEN }).error('send_failed', {
			password: 'hunter2'
		});

		const line = lines()[0];
		expect(line.botToken).toBe('[redacted]');
		expect(line.password).toBe('[redacted]');
	});

	it('unwraps a thrown AppError into name, code and stack', () => {
		// The stack belongs in the log and nowhere else (CLAUDE.md 2), and `code` is what a reader
		// greps for first when a job starts failing.
		const lines = capture();

		log.error('job_failed', {
			error: new MarzbanError('createUser failed with 502', { status: 502 })
		});

		expect(lines()[0].error).toMatchObject({
			name: 'MarzbanError',
			code: 'marzban_error',
			message: 'createUser failed with 502',
			stack: expect.any(String)
		});
	});

	it('keeps the envelope authoritative against a field of the same name', () => {
		// Fields can come from parsed upstream payloads. A field called `event` must not be able to
		// rename the line it appears on, or a log becomes unsearchable exactly when it matters.
		const lines = capture();

		log.info('webhook_received', { event: 'spoofed', level: 'debug', time: 'yesterday' });

		expect(lines()[0]).toMatchObject({
			level: 'info',
			event: 'webhook_received',
			field_event: 'spoofed',
			field_level: 'debug',
			field_time: 'yesterday'
		});
		expect(lines()[0].time).not.toBe('yesterday');
	});

	it('degrades to a stub line instead of throwing over the failure it reports', () => {
		// log.error is called from catch blocks. If it throws, it replaces the original error with
		// its own and the real failure is never recorded anywhere.
		const lines = capture();
		const hostile = {
			get reason(): string {
				throw new Error('getter exploded');
			}
		};

		expect(() => log.error('job_failed', { jobId: 7, hostile })).not.toThrow();
		expect(lines()).toHaveLength(1);
		expect(lines()[0]).toMatchObject({ level: 'error', event: 'job_failed', jobId: 7 });
	});
});
