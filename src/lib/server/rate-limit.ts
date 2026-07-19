/**
 * Fixed-window counters, in memory. tech.md 2 asks for three of them — initData 10/min per IP,
 * promo 5 per 10 min per person, support 3/hour — and one replica (tech.md 3) is what makes an
 * in-process Map enough. A shared store would be the answer the day a second replica exists.
 *
 * The window is fixed rather than sliding on purpose: a burst straddling a boundary can spend two
 * windows back to back, which is acceptable for abuse control and costs one map entry per key
 * instead of a timestamp list.
 */

export interface RateLimitDecision {
	allowed: boolean;
	/** Seconds until the window resets. Feeds RateLimitError and the Retry-After header. */
	retryAfterSec: number;
	/** Attempts left in the current window; zero once the caller has just spent the last one. */
	remaining: number;
}

export interface RateLimiterOptions {
	limit: number;
	windowMs: number;
	now?: () => number;
	/**
	 * Ceiling on tracked keys. The key is caller-controlled (an IP), so without a ceiling a spray
	 * of forged sources is an unbounded allocation in a long-lived process.
	 */
	maxKeys?: number;
}

interface Window {
	count: number;
	resetAt: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export class RateLimiter {
	readonly #windows = new Map<string, Window>();
	readonly #now: () => number;
	readonly #maxKeys: number;

	constructor(private readonly opts: RateLimiterOptions) {
		this.#now = opts.now ?? Date.now;
		this.#maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
	}

	/** Counts one attempt against `key` and says whether it may proceed. */
	check(key: string): RateLimitDecision {
		const now = this.#now();
		const existing = this.#windows.get(key);

		if (!existing || existing.resetAt <= now) {
			this.#evictIfCrowded(now);
			const window = { count: 1, resetAt: now + this.opts.windowMs };
			this.#windows.set(key, window);
			return this.#decide(window, now);
		}

		existing.count += 1;
		return this.#decide(existing, now);
	}

	#decide(window: Window, now: number): RateLimitDecision {
		const allowed = window.count <= this.opts.limit;
		return {
			allowed,
			// Ceil, so a caller who waits exactly this long lands after the reset, not on it.
			retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
			remaining: Math.max(0, this.opts.limit - window.count)
		};
	}

	#evictIfCrowded(now: number): void {
		if (this.#windows.size < this.#maxKeys) return;

		for (const [key, window] of this.#windows) {
			if (window.resetAt <= now) this.#windows.delete(key);
		}

		// Everything is still live: drop the oldest insertions, which Map iterates first. Losing a
		// counter costs one extra allowed attempt; refusing to forget costs the process.
		if (this.#windows.size >= this.#maxKeys) {
			const excess = this.#windows.size - this.#maxKeys + 1;
			let dropped = 0;
			for (const key of this.#windows.keys()) {
				this.#windows.delete(key);
				if (++dropped >= excess) break;
			}
		}
	}
}
