import { describe, expect, it } from 'vitest';
import { MarzbanError } from '$lib/server/errors';
import { MarzbanHttp, type MarzbanHttpOptions } from './http';

/**
 * Contract tests for tech.md 8. Every case here encodes something the spec states outright — the
 * seconds conversion, the subscription_url prefix, the retry policy, the token refresh — so they
 * would still hold against a rewrite of this client.
 */

interface Call {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | null;
	signal: AbortSignal | null | undefined;
}

class FetchStub {
	readonly calls: Call[] = [];
	#responses: Array<() => Response>;

	constructor(responses: Array<() => Response>) {
		this.#responses = responses;
	}

	readonly fetch: typeof globalThis.fetch = async (input, init) => {
		const request = init ?? {};
		this.calls.push({
			url: String(input),
			method: String(request.method ?? 'GET'),
			headers: { ...((request.headers as Record<string, string> | undefined) ?? {}) },
			body: typeof request.body === 'string' ? request.body : null,
			signal: request.signal
		});

		const next = this.#responses.shift();
		if (!next) throw new Error(`unexpected fetch call: ${String(input)}`);
		return next();
	};

	/** Requests that carried a bearer token, i.e. everything except the token exchange itself. */
	get apiCalls(): Call[] {
		return this.calls.filter((call) => !call.url.endsWith('/api/admin/token'));
	}

	get tokenCalls(): Call[] {
		return this.calls.filter((call) => call.url.endsWith('/api/admin/token'));
	}
}

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const token = (value = 'token-1'): Response => json({ access_token: value, token_type: 'bearer' });

const userPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	username: 'tg_100000001',
	status: 'active',
	expire: 1_700_000_000,
	used_traffic: 0,
	subscription_url: '/sub/tg_100000001',
	links: ['vless://example'],
	...overrides
});

function client(stub: FetchStub, overrides: Partial<MarzbanHttpOptions> = {}): MarzbanHttp {
	return new MarzbanHttp({
		baseUrl: 'http://marzban:8000',
		username: 'api',
		password: 'secret',
		inboundTags: ['VLESS TCP REALITY'],
		vlessFlow: 'xtls-rprx-vision',
		subUrlPrefix: 'https://sub.example.com',
		fetch: stub.fetch,
		now: () => 1_700_000_000_000,
		...overrides
	});
}

describe('MarzbanHttp.createUser', () => {
	it('sends expire in seconds, not milliseconds', async () => {
		const stub = new FetchStub([() => token(), () => json(userPayload())]);

		// A non-round millisecond value: a client that forgot to convert would send this verbatim,
		// and one that rounded up would land a second late.
		await client(stub).createUser({
			username: 'tg_100000001',
			expiresAtMs: 1_700_000_000_999,
			dataLimitBytes: 0
		});

		const body = JSON.parse(stub.apiCalls[0].body ?? '{}');
		expect(body.expire).toBe(1_700_000_000);
	});

	it('builds the body from config per tech.md 8', async () => {
		const stub = new FetchStub([() => token(), () => json(userPayload())]);

		await client(stub).createUser({
			username: 'tg_100000001',
			expiresAtMs: 1_700_000_000_000,
			dataLimitBytes: 42
		});

		const call = stub.apiCalls[0];
		expect(call.method).toBe('POST');
		expect(call.url).toBe('http://marzban:8000/api/user');
		expect(JSON.parse(call.body ?? '{}')).toMatchObject({
			username: 'tg_100000001',
			proxies: { vless: { flow: 'xtls-rprx-vision' } },
			inbounds: { vless: ['VLESS TCP REALITY'] },
			data_limit: 42,
			data_limit_reset_strategy: 'no_reset',
			status: 'active'
		});
	});

	it('exchanges credentials as form-urlencoded before calling the api', async () => {
		const stub = new FetchStub([() => token(), () => json(userPayload())]);

		await client(stub).createUser({
			username: 'tg_100000001',
			expiresAtMs: 1_700_000_000_000,
			dataLimitBytes: 0
		});

		const auth = stub.tokenCalls[0];
		expect(auth.headers['content-type']).toBe('application/x-www-form-urlencoded');
		expect(auth.body).toBe('username=api&password=secret');
		expect(stub.apiCalls[0].headers.authorization).toBe('Bearer token-1');
	});
});

describe('MarzbanHttp subscription url', () => {
	it('prefixes a relative subscription_url with the configured prefix', async () => {
		const stub = new FetchStub([
			() => token(),
			() => json(userPayload({ subscription_url: '/sub/tg_100000001' }))
		]);

		const user = await client(stub).createUser({
			username: 'tg_100000001',
			expiresAtMs: 1_700_000_000_000,
			dataLimitBytes: 0
		});

		expect(user.subscriptionUrl).toBe('https://sub.example.com/sub/tg_100000001');
	});

	it('leaves an absolute subscription_url alone', async () => {
		const absolute = 'https://sub.example.com/sub/abcdef';
		const stub = new FetchStub([
			() => token(),
			() => json(userPayload({ subscription_url: absolute }))
		]);

		const user = await client(stub).createUser({
			username: 'tg_100000001',
			expiresAtMs: 1_700_000_000_000,
			dataLimitBytes: 0
		});

		expect(user.subscriptionUrl).toBe(absolute);
	});
});

describe('MarzbanHttp retry policy', () => {
	it('retries a 5xx and succeeds', async () => {
		const stub = new FetchStub([
			() => token(),
			() => json({ detail: 'boom' }, 500),
			() => json({ detail: 'boom' }, 503),
			() => json(userPayload())
		]);

		const user = await client(stub).getUser('tg_100000001');

		expect(user?.username).toBe('tg_100000001');
		expect(stub.apiCalls).toHaveLength(3);
	});

	it('gives up after the retry budget and reports the upstream status', async () => {
		const stub = new FetchStub([
			() => token(),
			() => json({}, 502),
			() => json({}, 502),
			() => json({}, 502),
			() => json({}, 502)
		]);

		await expect(client(stub).getUser('tg_100000001')).rejects.toBeInstanceOf(MarzbanError);
		// One try plus three retries, per tech.md 8.
		expect(stub.apiCalls).toHaveLength(4);
	});

	it('does not retry a 4xx and reports its status', async () => {
		// 422 is the named trap: an inbound tag missing from xray_config.json. Retrying it just
		// multiplies a config error by four.
		const stub = new FetchStub([() => token(), () => json({ detail: 'unknown inbound' }, 422)]);

		const error = await client(stub)
			.createUser({ username: 'tg_100000001', expiresAtMs: 1_700_000_000_000, dataLimitBytes: 0 })
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(MarzbanError);
		expect((error as MarzbanError).status).toBe(422);
		expect(stub.apiCalls).toHaveLength(1);
	});

	it('retries a network failure', async () => {
		const stub = new FetchStub([
			() => token(),
			() => {
				throw new TypeError('fetch failed');
			},
			() => json(userPayload())
		]);

		const user = await client(stub).getUser('tg_100000001');

		expect(user).not.toBeNull();
		expect(stub.apiCalls).toHaveLength(2);
	});

	it('reports a timeout with no status after exhausting the budget', async () => {
		// tech.md 14 names the timeout as its own error path: a panel that hangs is not a panel that
		// answers 500, and a caller branching on `status` must be able to tell the two apart.
		const timeout = (): Response => {
			const err = new Error('The operation was aborted due to timeout');
			err.name = 'TimeoutError';
			throw err;
		};
		const stub = new FetchStub([() => token(), timeout, timeout, timeout, timeout]);

		const error = await client(stub)
			.getUser('tg_100000001')
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(MarzbanError);
		expect((error as MarzbanError).status).toBeNull();
		expect((error as MarzbanError).message).toContain('timed out');
		expect(stub.apiCalls).toHaveLength(4);
	});

	it('passes an abort signal so a hung panel cannot wedge a job forever', async () => {
		const stub = new FetchStub([() => token(), () => json(userPayload())]);

		await client(stub).getUser('tg_100000001');

		// Every call carries a deadline: without one, fetch waits indefinitely and the worker's
		// single job slot is held by a request that will never answer.
		expect(stub.calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
	});
});

describe('MarzbanHttp token handling', () => {
	it('refreshes the token once on 401 and replays the request', async () => {
		const stub = new FetchStub([
			() => token('token-1'),
			() => json({ detail: 'Not authenticated' }, 401),
			() => token('token-2'),
			() => json(userPayload())
		]);

		const user = await client(stub).getUser('tg_100000001');

		expect(user).not.toBeNull();
		expect(stub.tokenCalls).toHaveLength(2);
		expect(stub.apiCalls[0].headers.authorization).toBe('Bearer token-1');
		expect(stub.apiCalls[1].headers.authorization).toBe('Bearer token-2');
	});

	it('surfaces a second 401 instead of looping', async () => {
		const stub = new FetchStub([
			() => token('token-1'),
			() => json({}, 401),
			() => token('token-2'),
			() => json({}, 401)
		]);

		const error = await client(stub)
			.getUser('tg_100000001')
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(MarzbanError);
		expect((error as MarzbanError).status).toBe(401);
	});

	it('caches the token across calls and refetches it after the ttl', async () => {
		const stub = new FetchStub([
			() => token(),
			() => json(userPayload()),
			() => json(userPayload()),
			() => token('token-2'),
			() => json(userPayload())
		]);
		let clock = 1_700_000_000_000;
		const marzban = client(stub, { now: () => clock });

		await marzban.getUser('tg_100000001');
		await marzban.getUser('tg_100000001');
		expect(stub.tokenCalls).toHaveLength(1);

		clock += 60 * 60_000;
		await marzban.getUser('tg_100000001');
		expect(stub.tokenCalls).toHaveLength(2);
	});
});

describe('MarzbanHttp.getUser', () => {
	it('returns null on 404 rather than throwing', async () => {
		const stub = new FetchStub([() => token(), () => json({ detail: 'not found' }, 404)]);

		await expect(client(stub).getUser('tg_404')).resolves.toBeNull();
	});
});
