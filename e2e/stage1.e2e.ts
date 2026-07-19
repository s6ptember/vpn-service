import { createHmac } from 'node:crypto';
import {
	expect,
	test,
	type APIRequestContext,
	type APIResponse,
	type Page
} from '@playwright/test';

/**
 * Stage 1's acceptance criteria end to end: initData becomes a session cookie (A1), and the profile
 * shows who is signed in (A2). tech.md 14's full journey adds payment and QR to this file's path as
 * A5..A9 land.
 *
 * The bot token comes from .env — the same file `vite build` inlined into the preview server this
 * suite runs against, so the signature is computed against the key the server actually holds.
 */

try {
	process.loadEnvFile('.env');
} catch {
	// Docker and CI pass the values through the environment instead.
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required to sign test initData');

const FRAME = { width: 430, height: 880 };
test.use({ viewport: FRAME });

const ALEX = {
	id: 700_000_111,
	first_name: 'Александр',
	last_name: 'Ким',
	username: 'alex_k',
	language_code: 'ru'
};

/** Telegram's algorithm, written from the spec: sort by key, join with newlines, HMAC it. */
function signedInitData(user: Record<string, unknown>, options: { authDateSec?: number } = {}) {
	const fields: Record<string, string> = {
		user: JSON.stringify(user),
		auth_date: String(options.authDateSec ?? Math.floor(Date.now() / 1000))
	};
	const dataCheckString = Object.keys(fields)
		.sort()
		.map((key) => `${key}=${fields[key]}`)
		.join('\n');
	const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN!).digest();

	const params = new URLSearchParams(fields);
	params.set('hash', createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
	return params.toString();
}

const exchange = (request: APIRequestContext, initData: string) =>
	request.post('/api/auth/telegram', { data: { initData } });

const sessionCookie = (response: APIResponse): string | undefined =>
	response
		.headersArray()
		.find((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('session='))?.value;

/**
 * Signs a person in and moves the cookie into the browser context. The copy is needed because the
 * cookie is Secure and this suite runs on http://localhost, where Playwright would refuse to send
 * it — over the https origin the app actually ships on, the browser does this itself.
 */
async function signIn(page: Page, request: APIRequestContext, user: Record<string, unknown>) {
	const response = await exchange(request, signedInitData(user));
	expect(response.status()).toBe(200);

	const cookie = sessionCookie(response);
	expect(cookie, 'the exchange must set the session cookie').toBeDefined();

	const value = cookie!.split(';')[0].slice('session='.length);
	await page.context().addCookies([{ name: 'session', value, url: 'http://localhost:4173' }]);
}

/**
 * Each test signs in a different Telegram account. The preview server keeps one SQLite file for the
 * whole run, so sharing an id would let one test's upsert rewrite another's profile.
 */
const withId = (id: number) => ({ ...ALEX, id });

test.describe('initData exchange', () => {
	test('issues a session cookie for a payload signed with the bot token', async ({ request }) => {
		const response = await exchange(request, signedInitData(withId(700_000_001)));

		expect(response.status()).toBe(200);

		const cookie = sessionCookie(response);
		expect(cookie, 'the exchange must set the session cookie').toBeDefined();
		// tech.md 9: the mini app lives in a Telegram iframe, so 'lax' would drop the cookie —
		// and SameSite=None is only honoured on a Secure cookie.
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('Secure');
		expect(cookie).toContain('SameSite=None');
		expect(cookie).toContain('Path=/');
	});

	test('refuses a payload signed with the wrong key', async ({ request }) => {
		const forged = new URLSearchParams(signedInitData(withId(700_000_002)));
		forged.set('hash', 'f'.repeat(64));

		const response = await exchange(request, forged.toString());

		expect(response.status()).toBe(401);
		expect((await response.json()).code).toBe('auth_bad_signature');
		expect(response.headers()['set-cookie']).toBeUndefined();
	});

	test('refuses a payload whose user was edited after signing', async ({ request }) => {
		const raw = signedInitData(withId(700_000_003));
		const tampered = raw.replace(encodeURIComponent('700000003'), encodeURIComponent('1'));

		expect((await exchange(request, tampered)).status()).toBe(401);
	});

	test('refuses initData older than the configured max age', async ({ request }) => {
		const stale = signedInitData(withId(700_000_004), {
			authDateSec: Math.floor(Date.now() / 1000) - 90 * 24 * 60 * 60
		});

		const response = await exchange(request, stale);

		expect(response.status()).toBe(401);
		expect((await response.json()).code).toBe('auth_expired_init_data');
	});

	test('rejects a request that is not the documented shape', async ({ request }) => {
		expect((await request.post('/api/auth/telegram', { data: {} })).status()).toBe(400);
		expect(
			(await request.post('/api/auth/telegram', { data: 'not json', headers: {} })).status()
		).toBe(400);
	});
});

test.describe('profile', () => {
	test('shows the name and @username of whoever holds the cookie', async ({ page, request }) => {
		await signIn(page, request, { ...withId(700_000_010), username: 'kim_test' });

		await page.goto('/profile');

		await expect(page.getByRole('heading', { name: 'Профиль', level: 1 })).toBeVisible();
		await expect(page.getByText('Александр Ким')).toBeVisible();
		await expect(page.getByText('@kim_test')).toBeVisible();
		// No subscription yet: the empty state invites a purchase rather than reporting "no data".
		await expect(page.getByText('Подписки нет')).toBeVisible();
	});

	test('sends the empty state to the plans', async ({ page, request }) => {
		await signIn(page, request, withId(700_000_011));

		await page.goto('/profile');
		await expect(page.locator('[data-splash]')).toHaveCount(0);

		await page.getByRole('button', { name: 'Выбрать тариф' }).click();
		await expect(page).toHaveURL('/');
	});

	test('invites a visitor without a session to open the app from Telegram', async ({ page }) => {
		await page.goto('/profile');

		await expect(page.getByText('Профиль откроется после входа')).toBeVisible();
		await expect(page.getByText('@')).toHaveCount(0);
	});
});

/**
 * Last on purpose. Only refused attempts spend the budget, so the sign-ins above are unaffected —
 * but this test spends it deliberately, and every test here shares 127.0.0.1, so any refusal
 * expected after it would come back as a 429 instead of the code it was checking for.
 */
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
