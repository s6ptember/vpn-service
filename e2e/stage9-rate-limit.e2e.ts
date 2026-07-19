import { expect, test, type APIResponse } from '@playwright/test';
import { FRAME, exchange, signedInitData, withId } from './helpers';

/**
 * Runs last, and the file name is what makes it run last: one worker, alphabetical order.
 *
 * Only refused attempts spend the budget, so a valid sign-in never costs anything — but once this
 * test has spent it, every exchange from 127.0.0.1 is refused for the rest of the minute, including
 * the valid ones other suites depend on. Every e2e file shares that address.
 */

test.use({ viewport: FRAME });

test.describe('rate limit', () => {
	test('answers 429 with a Retry-After once the per-IP budget is spent', async ({ request }) => {
		// tech.md 2 caps the exchange at 10/min per IP. Bad signatures count too, which is the point:
		// the limit exists to cap the work a stranger can order.
		const forged = new URLSearchParams(signedInitData(withId(700_000_005)));
		forged.set('hash', 'a'.repeat(64));

		let refused: APIResponse | null = null;
		for (let attempt = 0; attempt < 15 && !refused; attempt++) {
			const response = await exchange(request, forged.toString());
			if (response.status() === 429) refused = response;
		}

		expect(refused, 'the exchange must stop answering after 10 attempts a minute').not.toBeNull();
		expect((await refused!.json()).code).toBe('rate_limit');
		expect(Number(refused!.headers()['retry-after'])).toBeGreaterThan(0);
	});
});
