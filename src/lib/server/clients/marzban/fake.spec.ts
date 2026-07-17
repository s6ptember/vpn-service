import { describe, expect, it } from 'vitest';
import { MarzbanError, ValidationError } from '$lib/server/errors';
import { FakeMarzban } from './fake';

/**
 * The fake is the test seam every slice is written against (tech.md 8), so it gets tested itself:
 * a seam that silently accepts garbage would let a broken slice reach the real panel.
 */

const input = {
	username: 'tg_100000001',
	expiresAtMs: 1_700_000_000_000,
	dataLimitBytes: 0
};

describe('FakeMarzban as a contract check', () => {
	it('accepts a valid input and reports an absolute subscription url', async () => {
		const marzban = new FakeMarzban();

		const user = await marzban.createUser(input);

		expect(user.subscriptionUrl).toBe('https://sub.local/sub/tg_100000001');
		expect(user.status).toBe('active');
		expect(user.expiresAtMs).toBe(input.expiresAtMs);
	});

	it.each([
		['a username outside the tg_<id> shape', { ...input, username: 'alex' }],
		['a username that is too long', { ...input, username: `tg_${'9'.repeat(40)}` }],
		['expiry in seconds instead of ms', { ...input, expiresAtMs: 0 }],
		['a fractional expiry', { ...input, expiresAtMs: 1_700_000_000_000.5 }],
		['a negative data limit', { ...input, dataLimitBytes: -1 }]
	])('rejects %s', async (_label, bad) => {
		const marzban = new FakeMarzban();

		await expect(marzban.createUser(bad)).rejects.toBeInstanceOf(ValidationError);
	});

	it('refuses a duplicate username the way the panel does', async () => {
		const marzban = new FakeMarzban();
		await marzban.createUser(input);

		const error = await marzban.createUser(input).catch((err: unknown) => err);

		expect(error).toBeInstanceOf(MarzbanError);
		expect((error as MarzbanError).status).toBe(409);
	});
});

describe('FakeMarzban.failNext', () => {
	it('fails exactly the next call, then disarms', async () => {
		const marzban = new FakeMarzban();
		marzban.failNext(500);

		const error = await marzban.getUser('tg_100000001').catch((err: unknown) => err);
		expect((error as MarzbanError).status).toBe(500);

		// Disarmed: the call after it behaves normally.
		await expect(marzban.getUser('tg_100000001')).resolves.toBeNull();
	});

	it('reports a timeout with no status, as a real timeout does', async () => {
		const marzban = new FakeMarzban();
		marzban.failNext('timeout');

		const error = await marzban.getUser('tg_100000001').catch((err: unknown) => err);

		expect(error).toBeInstanceOf(MarzbanError);
		expect((error as MarzbanError).status).toBeNull();
	});
});

describe('FakeMarzban state', () => {
	it('starts empty, matching a seeded db that has no subscriptions yet', async () => {
		const marzban = new FakeMarzban();

		await expect(marzban.getUser('tg_100000001')).resolves.toBeNull();
	});

	it('seeds and resets', async () => {
		const marzban = new FakeMarzban();
		marzban.seed([
			{
				username: 'tg_100000002',
				status: 'active',
				expiresAtMs: 1_700_000_000_000,
				usedTrafficBytes: 10,
				subscriptionUrl: 'https://sub.local/sub/tg_100000002',
				links: []
			}
		]);

		await expect(marzban.getUser('tg_100000002')).resolves.not.toBeNull();

		marzban.reset();
		await expect(marzban.getUser('tg_100000002')).resolves.toBeNull();
	});

	it('deletes idempotently so a retried job converges', async () => {
		const marzban = new FakeMarzban();
		await marzban.createUser(input);

		await marzban.deleteUser(input.username);
		await expect(marzban.deleteUser(input.username)).resolves.toBeUndefined();
		await expect(marzban.getUser(input.username)).resolves.toBeNull();
	});

	it('extends expiry through setExpiry', async () => {
		const marzban = new FakeMarzban();
		await marzban.createUser(input);
		const extended = input.expiresAtMs + 30 * 86_400_000;

		const user = await marzban.setExpiry(input.username, extended);

		expect(user.expiresAtMs).toBe(extended);
		await expect(marzban.getUser(input.username)).resolves.toMatchObject({
			expiresAtMs: extended
		});
	});

	it('does not hand out a reference into its own map', async () => {
		const marzban = new FakeMarzban();
		const created = await marzban.createUser(input);

		created.expiresAtMs = 1;

		// A caller mutating the returned object must not rewrite the fake's state, or tests would
		// pass against a store no real panel would ever behave like.
		await expect(marzban.getUser(input.username)).resolves.toMatchObject({
			expiresAtMs: input.expiresAtMs
		});
	});
});
