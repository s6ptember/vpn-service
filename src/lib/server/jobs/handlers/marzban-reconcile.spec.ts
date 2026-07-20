import { beforeEach, describe, expect, it } from 'vitest';
import { addPlan, addUser } from '$lib/server/billing/fixtures';
import { FakeMarzban, type MarzbanApi, type MarzbanUser } from '$lib/server/clients/marzban';
import type { Db } from '$lib/server/db/client';
import type { UserRow } from '$lib/server/db/schema';
import { DAY_MS, SubscriptionService } from '$lib/server/subscriptions';
import { createTestDb, silentLogger, TestClock } from '../fixtures';
import { JobQueue } from '../queue';
import { JobWorker } from '../worker';
import { MarzbanReconcileHandler } from './marzban-reconcile';

/**
 * A16's acceptance criterion, quoted from tech.md 6: "сверить локальный `expiresAt` с `expire` в
 * Marzban, локальное состояние — ведущее".
 *
 * Two things follow, and both are tested here rather than assumed: drift is resolved by writing to
 * the panel, and the local row is never written at all.
 */

const NOW = 1_784_000_000_000;
const ADMIN_CHAT_ID = 900_000_001;

/**
 * Counts what actually reached the panel. The assertion "a second run changes nothing" is only
 * meaningful if it means "issued no write", not "ended in the same state" — the latter is true of a
 * handler that rewrites the same values every time and hammers Marzban for a living.
 */
class CountingMarzban implements MarzbanApi {
	readonly calls = { getUser: 0, setExpiry: 0, setStatus: 0, createUser: 0, deleteUser: 0 };

	constructor(private readonly inner: FakeMarzban) {}

	createUser: MarzbanApi['createUser'] = (input) => {
		this.calls.createUser += 1;
		return this.inner.createUser(input);
	};

	getUser: MarzbanApi['getUser'] = (username) => {
		this.calls.getUser += 1;
		return this.inner.getUser(username);
	};

	setExpiry: MarzbanApi['setExpiry'] = (username, expiresAtMs) => {
		this.calls.setExpiry += 1;
		return this.inner.setExpiry(username, expiresAtMs);
	};

	setStatus: MarzbanApi['setStatus'] = (username, status) => {
		this.calls.setStatus += 1;
		return this.inner.setStatus(username, status);
	};

	deleteUser: MarzbanApi['deleteUser'] = (username) => {
		this.calls.deleteUser += 1;
		return this.inner.deleteUser(username);
	};
}

let db: Db;
let clock: TestClock;
let queue: JobQueue;
let subscriptions: SubscriptionService;
let fake: FakeMarzban;
let marzban: CountingMarzban;
let handler: MarzbanReconcileHandler;
let owner: UserRow;
let planId: number;
let username: string;

/** The local row: what we believe, and what the panel is to be brought in line with. */
function addSubscription(
	expiresAtMs: number,
	status: 'active' | 'expired' | 'revoked' = 'active'
): number {
	return subscriptions.upsert({
		userId: owner.id,
		planId,
		marzbanUsername: username,
		subscriptionUrl: `https://sub.local/sub/${username}`,
		startsAtMs: NOW - 30 * DAY_MS,
		expiresAtMs,
		status
	}).id;
}

/** The panel's side of the story, seeded independently so the two can disagree. */
function seedPanel(overrides: Partial<MarzbanUser> = {}): void {
	fake.seed([
		{
			username,
			status: 'active',
			expiresAtMs: NOW + 30 * DAY_MS,
			usedTrafficBytes: 0,
			subscriptionUrl: `https://sub.local/sub/${username}`,
			links: [],
			...overrides
		}
	]);
}

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock(NOW);
	queue = new JobQueue(db, clock.now);
	subscriptions = new SubscriptionService(db, { now: clock.now });
	fake = new FakeMarzban();
	marzban = new CountingMarzban(fake);
	owner = addUser(db);
	planId = addPlan(db).id;
	username = `tg_${owner.telegramId}`;

	handler = new MarzbanReconcileHandler(subscriptions, marzban, silentLogger(), { now: clock.now });
});

describe('MarzbanReconcileHandler', () => {
	it('pushes our expiry onto the panel when the two disagree', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);
		seedPanel({ expiresAtMs: NOW + 99 * DAY_MS });

		await handler.handle({ subscriptionId: id });

		expect((await fake.getUser(username))?.expiresAtMs).toBe(NOW + 10 * DAY_MS);
	});

	/**
	 * The direction is the whole contract. A panel that claims a later date must not be able to
	 * extend a subscription nobody paid for — the orders table would still say otherwise.
	 */
	it('never writes the panel state back into our row', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);
		seedPanel({ expiresAtMs: NOW + 99 * DAY_MS, status: 'disabled' });

		await handler.handle({ subscriptionId: id });

		const row = subscriptions.findById(id)!;
		expect(row.expiresAt.getTime()).toBe(NOW + 10 * DAY_MS);
		expect(row.status).toBe('active');
	});

	it('re-enables a panel user our date says still has time to run', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);
		seedPanel({ expiresAtMs: NOW + 10 * DAY_MS, status: 'disabled' });

		await handler.handle({ subscriptionId: id });

		expect((await fake.getUser(username))?.status).toBe('active');
	});

	it('disables a panel user whose term has run out', async () => {
		const id = addSubscription(NOW - DAY_MS);
		seedPanel({ expiresAtMs: NOW - DAY_MS, status: 'active' });

		await handler.handle({ subscriptionId: id });

		expect((await fake.getUser(username))?.status).toBe('disabled');
	});

	/**
	 * `expired` is Marzban's own conclusion, drawn from the stale date. Correcting the date is what
	 * resolves it, so the status write has to happen too — otherwise the user stays locked out with
	 * a correct expiry, which is the worst of both.
	 */
	it('brings back a user the panel expired under a stale date', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);
		seedPanel({ expiresAtMs: NOW - DAY_MS, status: 'expired' });

		await handler.handle({ subscriptionId: id });

		const remote = (await fake.getUser(username))!;
		expect(remote.expiresAtMs).toBe(NOW + 10 * DAY_MS);
		expect(remote.status).toBe('active');
	});

	// --- what "local state is leading" actually means (tech.md 6) ---------------------------------

	/**
	 * Revoking does not rewrite `expiresAt`, so a revoked subscription routinely holds a date in the
	 * future. Reading access off the date alone would hand it straight back to the person it was
	 * taken from — the one outcome this job must never produce.
	 */
	it('cuts off a subscription revoked by hand, whatever its date says', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS, 'revoked');
		seedPanel({ expiresAtMs: NOW + 10 * DAY_MS, status: 'active' });

		await handler.handle({ subscriptionId: id });

		expect((await fake.getUser(username))?.status).toBe('disabled');
	});

	it('never re-enables a revoked subscription the panel had already disabled', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS, 'revoked');
		seedPanel({ expiresAtMs: NOW + 10 * DAY_MS, status: 'disabled' });

		await handler.handle({ subscriptionId: id });

		expect((await fake.getUser(username))?.status).toBe('disabled');
		expect(marzban.calls.setStatus).toBe(0);
	});

	it('cuts off a subscription the sweep has already marked expired', async () => {
		const id = addSubscription(NOW - DAY_MS, 'expired');
		seedPanel({ expiresAtMs: NOW - DAY_MS, status: 'active' });

		await handler.handle({ subscriptionId: id });

		expect((await fake.getUser(username))?.status).toBe('disabled');
	});

	/**
	 * `limited` is Marzban's conclusion about the traffic quota — a thing this app does not track
	 * between provisions. Flipping it to `active` would hand back an allowance the panel had already
	 * spent, on a job whose remit is the expiry date.
	 */
	it('leaves a traffic-limited user alone rather than restoring their quota', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);
		seedPanel({ expiresAtMs: NOW + 10 * DAY_MS, status: 'limited' });

		await handler.handle({ subscriptionId: id });

		expect((await fake.getUser(username))?.status).toBe('limited');
		expect(marzban.calls.setStatus).toBe(0);
	});

	/** `on_hold` is a start-date state we do not model; overruling it would be guessing. */
	it('leaves an on-hold user alone', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);
		seedPanel({ expiresAtMs: NOW + 10 * DAY_MS, status: 'on_hold' });

		await handler.handle({ subscriptionId: id });

		expect((await fake.getUser(username))?.status).toBe('on_hold');
		expect(marzban.calls.setStatus).toBe(0);
	});

	/** The expiry half still runs for a revoked row: the panel should hold our date either way. */
	it('still corrects the date on a revoked subscription', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS, 'revoked');
		seedPanel({ expiresAtMs: NOW + 99 * DAY_MS, status: 'active' });

		await handler.handle({ subscriptionId: id });

		expect((await fake.getUser(username))?.expiresAtMs).toBe(NOW + 10 * DAY_MS);
	});

	// --- idempotency (tech.md 6) ------------------------------------------------------------------

	it('writes nothing at all when the two already agree', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);
		seedPanel({ expiresAtMs: NOW + 10 * DAY_MS, status: 'active' });

		await handler.handle({ subscriptionId: id });

		expect(marzban.calls.setExpiry).toBe(0);
		expect(marzban.calls.setStatus).toBe(0);
	});

	it('makes no second write however many times it runs', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);
		seedPanel({ expiresAtMs: NOW + 99 * DAY_MS, status: 'disabled' });

		await handler.handle({ subscriptionId: id });
		const afterFirst = { ...marzban.calls };

		await handler.handle({ subscriptionId: id });
		await handler.handle({ subscriptionId: id });

		expect(marzban.calls.setExpiry).toBe(afterFirst.setExpiry);
		expect(marzban.calls.setStatus).toBe(afterFirst.setStatus);
	});

	/**
	 * The path that makes convergence necessary rather than theoretical: a process died mid-job, the
	 * row is still `running`, and the worker re-runs it on the next start (jobs/worker.ts).
	 */
	it('survives a worker that restarts on top of a job it already finished', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);
		seedPanel({ expiresAtMs: NOW + 99 * DAY_MS });
		await handler.handle({ subscriptionId: id });
		const afterFirst = { ...marzban.calls };

		queue.enqueue('marzban.reconcile', { subscriptionId: id }, `reconcile:${id}:1`);
		const claimed = queue.claim()!;

		const worker = new JobWorker(queue, [handler], silentLogger(), { adminChatId: ADMIN_CHAT_ID });
		worker.start();
		worker.stop();

		clock.advance(60 * 60_000);
		await worker.tick();

		expect(queue.find(claimed.id)?.status).toBe('done');
		expect(marzban.calls.setExpiry).toBe(afterFirst.setExpiry);
	});

	// --- the error path (tech.md 14) --------------------------------------------------------------

	it.each(['timeout', 500] as const)('rethrows when Marzban answers %s', async (mode) => {
		const id = addSubscription(NOW + 10 * DAY_MS);
		seedPanel();
		fake.failNext(mode);

		await expect(handler.handle({ subscriptionId: id })).rejects.toThrow();
	});

	/** A retry has to be able to finish the job the failed attempt started. */
	it('reconciles on the retry after a failure', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);
		seedPanel({ expiresAtMs: NOW + 99 * DAY_MS });
		fake.failNext(500);
		await expect(handler.handle({ subscriptionId: id })).rejects.toThrow();

		await handler.handle({ subscriptionId: id });

		expect((await fake.getUser(username))?.expiresAtMs).toBe(NOW + 10 * DAY_MS);
	});

	/**
	 * A subscription with no panel user cannot be closed by this job — recreating it would need the
	 * plan's traffic limit and would paper over whatever deleted it. The alert is the deliverable.
	 */
	it('throws when the panel has no user for the subscription', async () => {
		const id = addSubscription(NOW + 10 * DAY_MS);

		await expect(handler.handle({ subscriptionId: id })).rejects.toThrow(/missing/);
		expect(marzban.calls.setExpiry).toBe(0);
	});

	it('throws on a subscription that does not exist rather than reporting success', async () => {
		await expect(handler.handle({ subscriptionId: 4242 })).rejects.toThrow(/4242/);
	});
});
