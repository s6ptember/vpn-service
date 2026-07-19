import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

/**
 * Derived from tech.md 2's limits ("initData exchange 10/min per IP"), not from the counter's
 * internals: N attempts pass, the next one does not, each key is counted on its own, and the
 * refusal says when to come back.
 */

const MINUTE = 60_000;

function limiter(overrides: Partial<{ limit: number; windowMs: number; maxKeys: number }> = {}) {
	let now = 1_700_000_000_000;
	const instance = new RateLimiter({
		limit: overrides.limit ?? 10,
		windowMs: overrides.windowMs ?? MINUTE,
		maxKeys: overrides.maxKeys,
		now: () => now
	});
	return {
		instance,
		advance: (ms: number) => {
			now += ms;
		}
	};
}

describe('RateLimiter', () => {
	it('allows exactly the configured number of attempts', () => {
		const { instance } = limiter({ limit: 10 });

		for (let attempt = 1; attempt <= 10; attempt++) {
			expect(instance.check('1.2.3.4').allowed).toBe(true);
		}
		expect(instance.check('1.2.3.4').allowed).toBe(false);
	});

	it('counts down the attempts left in the window', () => {
		const { instance } = limiter({ limit: 3 });

		expect(instance.check('ip').remaining).toBe(2);
		expect(instance.check('ip').remaining).toBe(1);
		expect(instance.check('ip').remaining).toBe(0);
		expect(instance.check('ip').remaining).toBe(0);
	});

	it('tells a refused caller when the window resets', () => {
		const { instance, advance } = limiter({ limit: 1, windowMs: MINUTE });

		instance.check('ip');
		advance(20_000);

		const refused = instance.check('ip');
		expect(refused.allowed).toBe(false);
		expect(refused.retryAfterSec).toBe(40);
	});

	it('never asks the caller to retry in zero seconds', () => {
		const { instance, advance } = limiter({ limit: 1, windowMs: MINUTE });

		instance.check('ip');
		advance(MINUTE - 1);

		expect(instance.check('ip').retryAfterSec).toBeGreaterThanOrEqual(1);
	});

	it('lets the caller back in once the window has passed', () => {
		const { instance, advance } = limiter({ limit: 2, windowMs: MINUTE });

		instance.check('ip');
		instance.check('ip');
		expect(instance.check('ip').allowed).toBe(false);

		advance(MINUTE);
		expect(instance.check('ip').allowed).toBe(true);
	});

	it('keeps one budget per key, so one abuser cannot lock everyone out', () => {
		const { instance } = limiter({ limit: 1 });

		expect(instance.check('1.1.1.1').allowed).toBe(true);
		expect(instance.check('1.1.1.1').allowed).toBe(false);
		expect(instance.check('2.2.2.2').allowed).toBe(true);
	});

	it('stays bounded when the key is a forged, never-repeating IP', () => {
		// The key comes from the caller, so an unbounded map is a memory leak with a remote switch.
		const { instance } = limiter({ limit: 10, maxKeys: 50 });

		for (let i = 0; i < 5_000; i++) {
			expect(instance.check(`10.0.${Math.floor(i / 256)}.${i % 256}`).allowed).toBe(true);
		}

		// Eviction must not hand out a free pass to whoever is being counted right now.
		for (let attempt = 1; attempt <= 10; attempt++) {
			expect(instance.check('9.9.9.9').allowed).toBe(true);
		}
		expect(instance.check('9.9.9.9').allowed).toBe(false);
	});
});
