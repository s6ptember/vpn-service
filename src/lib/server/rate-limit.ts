/**
 * Fixed-window counters, in memory. CLAUDE.md 2 asks for three of them — initData 10/min per IP,
 * promo 5 per 10 min per person, support 3/hour — and one replica (tech.md 3) is what makes an
 * in-process Map enough. A shared store would be the answer the day a second replica exists.
 *
 * The window is fixed rather than sliding on purpose: a burst straddling a boundary can spend two
 * windows back to back, which is acceptable for abuse control and costs one map entry per key
 * instead of a timestamp list.
 *
 * Reading and spending are separate calls (`peek` and `consume`) so a caller can gate on the budget
 * before doing expensive work and still decide for itself which outcomes are worth counting.
 */

export interface RateLimitDecision {
	allowed: boolean;
	/** Seconds until the window resets. Feeds RateLimitError and the Retry-After header. */
	retryAfterSec: number;
	/** Attempts left in the current window. */
	remaining: number;
}

export interface RateLimiterOptions {
	limit: number;
	windowMs: number;
	now?: () => number;
	/**
	 * Size at which a sweep of expired windows is triggered. It is a housekeeping threshold, not a
	 * hard cap: see #reclaim for why a live window is never dropped to stay under it.
	 */
	sweepAt?: number;
}

interface Window {
	count: number;
	resetAt: number;
}

const DEFAULT_SWEEP_AT = 10_000;

export class RateLimiter {
	readonly #windows = new Map<string, Window>();
	readonly #now: () => number;
	readonly #sweepAt: number;

	constructor(private readonly opts: RateLimiterOptions) {
		this.#now = opts.now ?? Date.now;
		this.#sweepAt = opts.sweepAt ?? DEFAULT_SWEEP_AT;
	}

	/** Reads the budget without spending it. Use it to refuse before doing the expensive work. */
	peek(key: string): RateLimitDecision {
		const now = this.#now();
		const window = this.#live(key, now);

		if (!window) return { allowed: true, retryAfterSec: 0, remaining: this.opts.limit };
		return this.#decide(window, now, window.count < this.opts.limit);
	}

	/** Counts one attempt against `key` and says whether that attempt was within budget. */
	consume(key: string): RateLimitDecision {
		const now = this.#now();
		let window = this.#live(key, now);

		if (!window) {
			this.#reclaim(now);
			window = { count: 0, resetAt: now + this.opts.windowMs };
			this.#windows.set(key, window);
		}

		window.count += 1;
		return this.#decide(window, now, window.count <= this.opts.limit);
	}

	#live(key: string, now: number): Window | null {
		const window = this.#windows.get(key);
		return window && window.resetAt > now ? window : null;
	}

	#decide(window: Window, now: number, allowed: boolean): RateLimitDecision {
		return {
			allowed,
			// Ceil, so a caller who waits exactly this long lands after the reset, not on it.
			retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
			remaining: Math.max(0, this.opts.limit - window.count)
		};
	}

	/**
	 * Drops windows that have already expired. It deliberately stops there: evicting a LIVE window
	 * would reset the counter of whoever it belongs to, and the first thing a stranger would do with
	 * that is spray fresh keys until the entry counting their own attempts falls out — unlimited
	 * attempts through the front door of the limiter itself.
	 *
	 * So the map may exceed sweepAt under a spray. What bounds it is the window: live entries are
	 * only ever the distinct keys seen in the last windowMs, and each is two numbers. Growth is
	 * transient, and the next sweep reclaims it.
	 */
	#reclaim(now: number): void {
		if (this.#windows.size < this.#sweepAt) return;

		for (const [key, window] of this.#windows) {
			if (window.resetAt <= now) this.#windows.delete(key);
		}
	}
}
