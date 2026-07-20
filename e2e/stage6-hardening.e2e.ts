import { expect, test } from '@playwright/test';
import { FRAME, hydrated, signIn, withId } from './helpers';

/**
 * Stage 6, A17 — the response headers, asserted against a real server rather than read back out of
 * hooks.server.ts.
 *
 * Two of these assertions are the unusual kind: they pin the ABSENCE of a header. `X-Frame-Options`
 * and a narrower CSP both look like obvious hardening wins, both are one commit away at any time,
 * and either one blanks the mini app inside Telegram Web and Desktop (tech.md 9). A test is the only
 * thing standing between that and a security pass done in good faith.
 *
 * HSTS is deliberately not tested here: caddy terminates TLS and sets it, and the preview server
 * this suite runs against is plain HTTP with no caddy in front of it. Asserting it would either fail
 * always or pass vacuously.
 */

test.use({ viewport: FRAME });

const RUN = Date.now() % 100_000;
const READER = 701_200_000 + RUN;

test.describe('the response headers', () => {
	test('frames the app for Telegram and for nobody else', async ({ request }) => {
		const response = await request.get('/');

		expect(response.headers()['content-security-policy']).toBe(
			'frame-ancestors https://web.telegram.org https://*.telegram.org;'
		);
	});

	/** tech.md 9: "не ставим X-Frame-Options вовсе". Any value blanks the app in Telegram Web. */
	test('never sends X-Frame-Options', async ({ request }) => {
		const response = await request.get('/');

		expect(response.headers()['x-frame-options']).toBeUndefined();
	});

	/**
	 * The CSP has to stay exactly this permissive in every direction but framing. A `default-src` or
	 * a `script-src` added here without the matching `kit.csp` config would stop SvelteKit's own
	 * inline hydration script and leave a blank page that still passes a header scan.
	 */
	test('sends no CSP directive beyond frame-ancestors', async ({ request }) => {
		const csp = (await request.get('/')).headers()['content-security-policy'];

		expect(csp).not.toMatch(/script-src|default-src/);
	});

	test('sends the rest of the baseline', async ({ request }) => {
		const headers = (await request.get('/')).headers();

		expect(headers['x-content-type-options']).toBe('nosniff');
		expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
		expect(headers['permissions-policy']).toContain('camera=()');
		expect(headers['permissions-policy']).toContain('geolocation=()');
	});

	// --- caching (A17) ----------------------------------------------------------------------------

	/**
	 * A signed-in render carries the subscription URL, which is the credential to the VPN itself. A
	 * copy of that in a shared cache is a leak rather than a stale page.
	 */
	test('forbids caching a page rendered for a signed-in person', async ({ page, request }) => {
		await signIn(page, request, withId(READER));
		await page.goto('/profile');
		await hydrated(page);

		const response = await request.get('/profile');

		expect(response.headers()['cache-control']).toBe('no-store');
	});

	/**
	 * The anonymous shell is the same bytes for everybody and is what every visitor gets before the
	 * cookie exists (tech.md 9). Marking it no-store would cost that render for no benefit.
	 */
	test('leaves the anonymous shell cacheable', async ({ browser }) => {
		const context = await browser.newContext();
		const response = await context.request.get('/');
		await context.close();

		expect(response.headers()['cache-control']).not.toBe('no-store');
	});
});
