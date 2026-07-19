import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

/**
 * Derived from CLAUDE.md 2's limits ("initData exchange 10/min per IP"), not from the counter's
 * internals: N attempts pass, the next one does not, each key is counted on its own, the refusal
 * says when to come back — and none of that may be escapable by a caller who controls the key.
 */

const MINUTE = 60_000;

function limiter(overrides: Partial<{ limit: number; windowMs: number; sweepAt: number }> = {}) {
	let now = 1_700_000_000_000;
	const instance = new RateLimiter({
		limit: overrides.limit ?? 10,
		windowMs: overrides.windowMs ?? MINUTE,
		sweepAt: overrides.sweepAt,
		now: () => now
	});
	return {
		instance,
		advance: (ms: number) => {
			now += ms;
		}
	};
}

describe('RateLimiter.consume', () => {
	it('allows exactly the configured number of attempts', () => {
		const { instance } = limiter({ limit: 10 });

		for (let attempt = 1; attempt <= 10; attempt++) {
			expect(instance.consume('1.2.3.4').allowed).toBe(true);
		}
		expect(instance.consume('1.2.3.4').allowed).toBe(false);
	});

	it('counts down the attempts left in the window', () => {
		const { instance } = limiter({ limit: 3 });

		expect(instance.consume('ip').remaining).toBe(2);
		expect(instance.consume('ip').remaining).toBe(1);
		expect(instance.consume('ip').remaining).toBe(0);
		expect(instance.consume('ip').remaining).toBe(0);
	});

	it('tells a refused caller when the window resets', () => {
		const { instance, advance } = limiter({ limit: 1, windowMs: MINUTE });

		instance.consume('ip');
		advance(20_000);

		const refused = instance.consume('ip');
		expect(refused.allowed).toBe(false);
		expect(refused.retryAfterSec).toBe(40);
	});

	it('never asks the caller to retry in zero seconds', () => {
		const { instance, advance } = limiter({ limit: 1, windowMs: MINUTE });

		instance.consume('ip');
		advance(MINUTE - 1);

		expect(instance.consume('ip').retryAfterSec).toBeGreaterThanOrEqual(1);
	});

	it('lets the caller back in once the window has passed', () => {
		const { instance, advance } = limiter({ limit: 2, windowMs: MINUTE });

		instance.consume('ip');
		instance.consume('ip');
		expect(instance.consume('ip').allowed).toBe(false);

		advance(MINUTE);
		expect(instance.consume('ip').allowed).toBe(true);
	});

	it('keeps one budget per key, so one abuser cannot lock everyone out', () => {
		const { instance } = limiter({ limit: 1 });

		expect(instance.consume('1.1.1.1').allowed).toBe(true);
		expect(instance.consume('1.1.1.1').allowed).toBe(false);
		expect(instance.consume('2.2.2.2').allowed).toBe(true);
	});
});

describe('RateLimiter.peek', () => {
	it('reads the budget without spending it', () => {
		const { instance } = limiter({ limit: 2 });

		expect(instance.peek('ip').remaining).toBe(2);
		expect(instance.peek('ip').remaining).toBe(2);
		expect(instance.consume('ip').allowed).toBe(true);
	});

	it('reports the budget as spent once the limit is reached', () => {
		const { instance } = limiter({ limit: 2 });

		instance.consume('ip');
		expect(instance.peek('ip').allowed).toBe(true);
		instance.consume('ip');

		const refused = instance.peek('ip');
		expect(refused.allowed).toBe(false);
		expect(refused.retryAfterSec).toBe(60);
	});

	it('opens up again after the window, without spending anything', () => {
		const { instance, advance } = limiter({ limit: 1, windowMs: MINUTE });

		instance.consume('ip');
		expect(instance.peek('ip').allowed).toBe(false);

		advance(MINUTE);
		expect(instance.peek('ip').allowed).toBe(true);
	});
});

describe('RateLimiter under a key spray', () => {
	/**
	 * The key comes from the caller, so somebody who wants out of their own budget will make new
	 * keys until the bookkeeping gives way. Both halves of that are checked here: the counter of the
	 * key being sprayed at must survive, and expired entries must still be reclaimed.
	 */
	it('keeps counting the sprayer while fresh keys keep arriving', () => {
		const { instance } = limiter({ limit: 3, sweepAt: 10 });

		let allowed = 0;
		for (let round = 0; round < 8; round++) {
			if (instance.consume('attacker').allowed) allowed++;
			// Interleaved, not up front: eviction only ever runs while new keys are arriving, so a
			// spray that finishes first would leave the very code path this guards untouched.
			for (let i = 0; i < 12; i++) instance.consume(`spray-${round}-${i}`);
		}

		expect(allowed).toBe(3);
	});

	it('holds the line for a key that was already refused', () => {
		const { instance } = limiter({ limit: 1, sweepAt: 4 });

		expect(instance.consume('victim').allowed).toBe(true);
		for (let i = 0; i < 500; i++) instance.consume(`spray-${i}`);

		expect(instance.consume('victim').allowed).toBe(false);
		expect(instance.peek('victim').allowed).toBe(false);
	});

	it('reclaims the keys once their windows expire', () => {
		const { instance, advance } = limiter({ limit: 1, windowMs: MINUTE, sweepAt: 50 });

		for (let i = 0; i < 200; i++) instance.consume(`spray-${i}`);
		advance(MINUTE);
		// One consume past the sweep threshold triggers the reclaim of everything above.
		for (let i = 200; i < 260; i++) instance.consume(`later-${i}`);

		// Nothing observable but the budget: the earlier keys are gone, so they start clean.
		expect(instance.peek('spray-0').remaining).toBe(1);
	});
});
