import { invalidate } from '$app/navigation';
import type { OrderDTO, SubscriptionDTO } from '$lib/types';

/**
 * A7 — what the app shows between "opened the payment page" and "the key is here".
 *
 * There is no realtime in this project (tech.md 3): no SSE, no websocket. The person pays in an
 * external browser and comes back through a deeplink, and the app finds out by asking again. So
 * this class polls `invalidate('app:subscription')` every 3 seconds for up to a minute — tech.md's
 * numbers, not invented ones — and reads the answer off the load's own data.
 */

const POLL_EVERY_MS = 3_000;
const GIVE_UP_AFTER_MS = 60_000;

/** What the deeplink says about why the app was reopened (tech.md 10, step 6). */
export const ORDER_PARAM = /^order_/;
export const CANCEL_PARAM = /^cancel_/;

export type CheckoutPhase =
	/** Nothing to announce. The screen looks exactly as it does on any other visit. */
	| 'idle'
	/** Waiting for the payment itself. */
	| 'waiting'
	/** The money landed; `subscription.provision` has not finished yet. */
	| 'granting'
	/** Access is live and the link is on the profile. */
	| 'ready'
	/** The payment did not go through, or the session expired. */
	| 'failed'
	/** They came back through the cancel link. */
	| 'canceled'
	/** A minute went by and it is still not settled. */
	| 'timeout';

const TERMINAL: ReadonlySet<CheckoutPhase> = new Set<CheckoutPhase>([
	'ready',
	'failed',
	'canceled',
	'timeout'
]);

/** The slice of the page's data this watcher reads. Supplied by a getter, never copied. */
export interface CheckoutView {
	subscription: SubscriptionDTO | null;
	latestOrder: OrderDTO | null;
	awaitingKey: boolean;
}

export interface CheckoutWatcherOptions {
	/** Injected so a spec can drive the poll with fake timers instead of waiting a real minute. */
	invalidate?: (key: string) => Promise<void>;
	now?: () => number;
}

export class CheckoutWatcher {
	/**
	 * Whether there is anything to announce at all. It starts false and only a deliberate call
	 * flips it, which is the guard against the app greeting somebody with «Оплачено» over a
	 * purchase they made last month: a cold visit announces nothing, however many paid orders the
	 * person has.
	 */
	#announcing = $state(false);
	#gaveUp = $state(false);
	#canceled = $state(false);

	/**
	 * The order this watcher is waiting for, when it knows. `data` still describes the world as it
	 * was when the page loaded — the order that was just opened is not in it — so without this the
	 * machine would read the PREVIOUS order, find it paid and provisioned, and announce «Готово»
	 * over a payment nobody has made yet.
	 *
	 * Null on the deeplink path, where there is nothing to be stale: Telegram has just relaunched
	 * the app and the load ran after the payment, not before it.
	 */
	#expectedOrderId = $state<number | null>(null);

	#polling = false;
	#startedAt = 0;
	#timer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Whichever page is on screen supplies this. It is a getter over that page's `data`, replaced on
	 * every mount rather than owned by the watcher, because the watcher outlives the page: a person
	 * who taps Купить and then swipes to Профиль must not lose the wait they started.
	 */
	#read = $state<(() => CheckoutView) | null>(null);

	readonly #invalidate: (key: string) => Promise<void>;
	readonly #now: () => number;

	constructor(opts: CheckoutWatcherOptions = {}) {
		this.#invalidate = opts.invalidate ?? invalidate;
		this.#now = opts.now ?? Date.now;
	}

	/** Called from a page's $effect. Returns the detach function that effect should give back. */
	attach(read: () => CheckoutView): () => void {
		this.#read = read;

		return () => {
			// Only if nobody else has taken over: two pages overlap for one tick during a transition.
			if (this.#read === read) this.#read = null;
		};
	}

	#view(): CheckoutView {
		return this.#read?.() ?? { subscription: null, latestOrder: null, awaitingKey: false };
	}

	/**
	 * A getter over reactive state, so every screen derives from it and nothing has to be kept in
	 * sync by hand. The state itself is three booleans; everything else is read from the load
	 * (CLAUDE.md 1.1 — computed values are $derived, never an $effect writing into $state).
	 */
	get phase(): CheckoutPhase {
		if (this.#canceled) return 'canceled';
		if (!this.#announcing) return 'idle';

		const { latestOrder, awaitingKey } = this.#view();

		// Nothing to read yet, or what we can read predates the order we are waiting for.
		if (
			latestOrder === null ||
			(this.#expectedOrderId !== null && latestOrder.id !== this.#expectedOrderId)
		) {
			return this.#gaveUp ? 'timeout' : 'waiting';
		}

		switch (latestOrder.status) {
			case 'failed':
			case 'canceled':
				return 'failed';
			case 'paid':
				// Paid is not the same as usable: the webhook only queues the provision job.
				return awaitingKey ? (this.#gaveUp ? 'timeout' : 'granting') : 'ready';
			default:
				return this.#gaveUp ? 'timeout' : 'waiting';
		}
	}

	/** True once the answer is in, whatever the answer was. The page stops the spinner on it. */
	get settled(): boolean {
		return TERMINAL.has(this.phase);
	}

	/** Whether the load has caught up with the order this watcher is waiting for. */
	get #current(): boolean {
		const { latestOrder } = this.#view();
		return this.#expectedOrderId === null || latestOrder?.id === this.#expectedOrderId;
	}

	/**
	 * Whether the payment itself succeeded, even if the key has not arrived. The «не дождались»
	 * screen reads it: telling somebody who has been charged that nothing happened would be both
	 * wrong and alarming.
	 */
	get paid(): boolean {
		return this.#current && this.#view().latestOrder?.status === 'paid';
	}

	/**
	 * Starts announcing and, unless the answer is already in, starts asking.
	 *
	 * `orderId` comes from the checkout action. Pass it whenever it is known: it is what stops the
	 * previous, already-paid order from being mistaken for this one.
	 */
	start(orderId: number | null = null): void {
		this.#announcing = true;
		this.#canceled = false;
		this.#gaveUp = false;
		this.#expectedOrderId = orderId;
		this.#startedAt = this.#now();

		if (this.settled || this.#polling) return;

		this.#polling = true;
		this.#schedule();
	}

	/** The `cancel_<publicId>` deeplink: they walked away from the payment page on purpose. */
	markCanceled(): void {
		this.stop();
		this.#announcing = true;
		this.#canceled = true;
	}

	/** Clears the banner. The page calls it when the person dismisses or navigates away. */
	dismiss(): void {
		this.stop();
		this.#announcing = false;
		this.#canceled = false;
		this.#gaveUp = false;
		this.#expectedOrderId = null;
	}

	/**
	 * Timers live outside Svelte, so they are stopped by hand.
	 *
	 * Deliberately NOT called when a page unmounts: the wait belongs to the person, not to the
	 * screen they happen to be looking at. Swiping to Профиль mid-payment used to throw the wait
	 * away — no banner, every Купить live again, and a second order one tap from a second charge.
	 */
	stop(): void {
		this.#polling = false;
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
	}

	#schedule(): void {
		this.#timer = setTimeout(() => void this.#poll(), POLL_EVERY_MS);
	}

	/**
	 * One chained timeout rather than setInterval: the next question is asked only after the
	 * previous answer is in, so a slow load can never stack requests on top of each other.
	 */
	async #poll(): Promise<void> {
		if (!this.#polling) return;

		if (this.#now() - this.#startedAt >= GIVE_UP_AFTER_MS) {
			this.#gaveUp = true;
			this.stop();
			return;
		}

		await this.#invalidate('app:subscription');

		if (!this.#polling) return;
		if (this.settled) {
			this.stop();
			return;
		}

		this.#schedule();
	}
}

/**
 * Reads why Telegram reopened the app. `start_param` carries `order_<publicId>` after a payment
 * attempt and `cancel_<publicId>` after a walkaway (tech.md 10, step 6).
 *
 * The publicId in it is deliberately NOT matched against anything. OrderDTO carries no publicId —
 * the type is frozen in tech.md 7 — and inventing one would be exactly the contract the rules
 * forbid. It costs nothing here: the parameter only says "a payment attempt just ended, go and
 * look", and what the screen then reports is the person's real access as the server describes it,
 * not a claim about one order. The one risk that substitution creates — announcing an old purchase
 * — is closed by `#announcing` starting false, and pinned by a test.
 */
export function checkoutReturn(startParam: string | undefined): 'returned' | 'canceled' | null {
	if (!startParam) return null;
	if (CANCEL_PARAM.test(startParam)) return 'canceled';
	if (ORDER_PARAM.test(startParam)) return 'returned';
	return null;
}

/**
 * The same reading, but only the FIRST time a given parameter is seen.
 *
 * `start_param` is fixed for the whole mini-app launch while the client router destroys and
 * rebuilds a page on every trip between sections. Reading it per mount replayed the old banner on
 * every return to Главная — and «Оплата отменена» would come back to somebody who had since paid
 * and dismissed it.
 */
let consumedStartParam: string | null = null;

export function consumeCheckoutReturn(
	startParam: string | undefined
): 'returned' | 'canceled' | null {
	if (!startParam || startParam === consumedStartParam) return null;

	const outcome = checkoutReturn(startParam);
	if (outcome !== null) consumedStartParam = startParam;

	return outcome;
}

/** Test seam only: module state persists across cases inside one vitest file. */
export function resetConsumedStartParam(): void {
	consumedStartParam = null;
}

/**
 * One watcher for the whole app.
 *
 * A module singleton, which CLAUDE.md 1.2 forbids on the SERVER — there a module lives for the
 * process and is shared by every request. This is client state: one browser tab, one person, and
 * nothing under `$lib/server` imports it. The same exemption `toasts.svelte.ts` already relies on.
 *
 * It has to outlive a component, because the thing it tracks does: a payment opened from Главная is
 * still in flight while the person is reading Профиль. Each page calls `attach()` from an $effect
 * to lend it a view of its own load data.
 */
export const checkoutWatcher = new CheckoutWatcher();
