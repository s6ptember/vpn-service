import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderDTO, SubscriptionDTO } from '$lib/types';
import { CheckoutWatcher, checkoutReturn, type CheckoutView } from './checkout.svelte';

/**
 * A7's acceptance criteria, tech.md 16: `start_param=order_<publicId>`, poll `invalidate` for up to
 * a minute, and show «оплачено» or «не дождались».
 *
 * The load is the world here, so the specs move the load's answer around and assert what the screen
 * would say. Time is a parameter and the timers are fake — nothing sleeps.
 */

vi.mock('$app/navigation', () => ({ invalidate: async () => {} }));

const DAY_MS = 86_400_000;
const PAID_AT = 1_784_000_000_000;

const order = (overrides: Partial<OrderDTO> = {}): OrderDTO => ({
	id: 1,
	plan: {
		name: '30 дней',
		durationDays: 30,
		priceMinor: 499,
		currency: 'usd',
		trafficLimitBytes: 0
	},
	status: 'pending',
	finalPriceMinor: 499,
	currency: 'usd',
	createdAt: PAID_AT - 60_000,
	paidAt: null,
	...overrides
});

const subscription = (overrides: Partial<SubscriptionDTO> = {}): SubscriptionDTO => ({
	planName: '30 дней',
	status: 'active',
	expiresAt: PAID_AT + 30 * DAY_MS,
	daysLeft: 30,
	subscriptionUrl: 'https://sub.local/sub/tg_1',
	...overrides
});

/** A mutable stand-in for the page's data, so a test can "let the webhook land" between polls. */
class FakeLoad {
	view: CheckoutView = { subscription: null, latestOrder: null, awaitingKey: false };
	polls = 0;

	read = (): CheckoutView => this.view;

	invalidate = async (): Promise<void> => {
		this.polls += 1;
	};
}

let load: FakeLoad;
let clock: number;

const watcher = () =>
	new CheckoutWatcher(load.read, { invalidate: load.invalidate, now: () => clock });

/** Runs the poll loop forward by `ms` of both timer time and clock time. */
async function advance(ms: number) {
	for (let step = 0; step < ms; step += 1_000) {
		clock += 1_000;
		await vi.advanceTimersByTimeAsync(1_000);
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	load = new FakeLoad();
	clock = PAID_AT;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('CheckoutWatcher', () => {
	it('announces nothing until somebody actually starts a checkout', () => {
		// The safety property behind keying on the latest order rather than on the publicId in
		// start_param: a person who bought a month ago and opens the app must not be told «Оплачено»
		// all over again.
		load.view = {
			subscription: subscription(),
			latestOrder: order({ status: 'paid', paidAt: PAID_AT - 30 * DAY_MS }),
			awaitingKey: false
		};

		expect(watcher().phase).toBe('idle');
	});

	it('waits while the order is still pending', async () => {
		load.view = { subscription: null, latestOrder: order(), awaitingKey: false };
		const w = watcher();

		w.start();
		expect(w.phase).toBe('waiting');

		await advance(9_000);

		// tech.md 3: once every three seconds.
		expect(load.polls).toBe(3);
		expect(w.phase).toBe('waiting');
		w.stop();
	});

	it('stops at «ключ готов» once the subscription covers the payment', async () => {
		load.view = { subscription: null, latestOrder: order(), awaitingKey: false };
		const w = watcher();
		w.start();

		// The webhook lands: paid, but the provision job has not run yet.
		load.view = {
			subscription: null,
			latestOrder: order({ status: 'paid', paidAt: PAID_AT }),
			awaitingKey: true
		};
		await advance(3_000);

		// Paid alone is not «готово» — the profile would still have no key to show.
		expect(w.phase).toBe('granting');
		expect(w.paid).toBe(true);

		// And now the job finishes.
		load.view = {
			subscription: subscription(),
			latestOrder: order({ status: 'paid', paidAt: PAID_AT }),
			awaitingKey: false
		};
		await advance(3_000);

		expect(w.phase).toBe('ready');
		expect(w.settled).toBe(true);

		// Settled means the asking stops; a resolved checkout must not keep hitting the server.
		const polls = load.polls;
		await advance(30_000);
		expect(load.polls).toBe(polls);
	});

	it('gives up after a minute and says the payment did not arrive', async () => {
		load.view = { subscription: null, latestOrder: order(), awaitingKey: false };
		const w = watcher();
		w.start();

		await advance(59_000);
		expect(w.phase).toBe('waiting');

		await advance(3_000);

		// tech.md 3: «Ждём подтверждение оплаты», максимум минуту.
		expect(w.phase).toBe('timeout');
		expect(w.paid).toBe(false);

		const polls = load.polls;
		await advance(30_000);
		expect(load.polls).toBe(polls);
	});

	it('stays honest when the minute runs out on a payment that DID land', async () => {
		load.view = {
			subscription: null,
			latestOrder: order({ status: 'paid', paidAt: PAID_AT }),
			awaitingKey: true
		};
		const w = watcher();
		w.start();

		await advance(62_000);

		expect(w.phase).toBe('timeout');
		// The screen must not tell somebody who has been charged that nothing happened: the job
		// backoff alone can outlast the minute.
		expect(w.paid).toBe(true);
	});

	it('reports a payment that failed rather than one that is late', async () => {
		load.view = { subscription: null, latestOrder: order(), awaitingKey: false };
		const w = watcher();
		w.start();

		load.view = {
			subscription: null,
			latestOrder: order({ status: 'failed' }),
			awaitingKey: false
		};
		await advance(3_000);

		expect(w.phase).toBe('failed');
		expect(w.settled).toBe(true);
	});

	it('shows the cancelled state without asking the server anything', () => {
		load.view = { subscription: null, latestOrder: order(), awaitingKey: false };
		const w = watcher();

		w.markCanceled();

		expect(w.phase).toBe('canceled');
		expect(load.polls).toBe(0);
	});

	it('goes quiet when dismissed', async () => {
		load.view = { subscription: null, latestOrder: order(), awaitingKey: false };
		const w = watcher();
		w.start();
		await advance(3_000);

		w.dismiss();

		expect(w.phase).toBe('idle');
		const polls = load.polls;
		await advance(30_000);
		expect(load.polls).toBe(polls);
	});
});

describe('checkoutReturn', () => {
	it('reads why Telegram reopened the app', () => {
		expect(checkoutReturn('order_9aBcD')).toBe('returned');
		expect(checkoutReturn('cancel_9aBcD')).toBe('canceled');
		expect(checkoutReturn(undefined)).toBeNull();
		expect(checkoutReturn('')).toBeNull();
		// A deeplink somebody else built, or a future parameter this slice knows nothing about.
		expect(checkoutReturn('promo_summer')).toBeNull();
	});
});
