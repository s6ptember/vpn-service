import { createHmac } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

/**
 * Shared sign-in machinery for the e2e suites. It lives apart from any one stage because every
 * stage after A1 starts by getting a session, and a second copy of Telegram's hashing algorithm
 * would be a second place to get it wrong.
 *
 * The bot token comes from .env — the same file `vite build` inlined into the preview server these
 * suites run against, so the signature is computed against the key the server actually holds.
 */

try {
	process.loadEnvFile('.env');
} catch {
	// Docker and CI pass the values through the environment instead.
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required to sign test initData');

/** The one person the app treats as an admin (tech.md 5: it is derived from .env, never stored). */
export const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID);
if (!Number.isSafeInteger(ADMIN_CHAT_ID) || ADMIN_CHAT_ID <= 0) {
	throw new Error('ADMIN_CHAT_ID is required to sign in as the admin');
}

/** The mini app's frame. Every suite renders at the size the mock was drawn for. */
export const FRAME = { width: 430, height: 880 };

export const ALEX = {
	id: 700_000_111,
	first_name: 'Александр',
	last_name: 'Ким',
	username: 'alex_k',
	language_code: 'ru'
};

/**
 * Each test signs in a different Telegram account. The preview server keeps one SQLite file for the
 * whole run, so sharing an id would let one test's upsert rewrite another's profile.
 */
export const withId = (id: number) => ({ ...ALEX, id });

/** Telegram's algorithm, written from the spec: sort by key, join with newlines, HMAC it. */
export function signedInitData(
	user: Record<string, unknown>,
	options: { authDateSec?: number } = {}
) {
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

export const exchange = (request: APIRequestContext, initData: string) =>
	request.post('/api/auth/telegram', { data: { initData } });

export const sessionCookie = (response: APIResponse): string | undefined =>
	response
		.headersArray()
		.find((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('session='))?.value;

/**
 * Signs a person in and moves the cookie into the browser context. The copy is needed because the
 * cookie is Secure and this suite runs on http://localhost, where Playwright would refuse to send
 * it — over the https origin the app actually ships on, the browser does this itself.
 */
export async function signIn(
	page: Page,
	request: APIRequestContext,
	user: Record<string, unknown>
) {
	const response = await exchange(request, signedInitData(user));
	expect(response.status()).toBe(200);

	const cookie = sessionCookie(response);
	expect(cookie, 'the exchange must set the session cookie').toBeDefined();

	const value = cookie!.split(';')[0].slice('session='.length);
	await page.context().addCookies([{ name: 'session', value, url: 'http://localhost:4173' }]);
}

/** The layout holds a splash over everything until the handshake settles. Wait for it, or a click
 *  lands before the page is listening. */
export const hydrated = (page: Page) => expect(page.locator('[data-splash]')).toHaveCount(0);

/**
 * Opens the bottom sheet holding the plan deck from Главная's Текущий план card. Every stage after
 * the dashboard redesign starts a purchase this way instead of finding the cards already on the
 * page — the button's own aria-label, not its visible "Купить", keeps this from also matching a
 * plan card's own buy button once the sheet is open.
 */
export async function openBuySheet(page: Page) {
	await hydrated(page);
	await page.getByRole('button', { name: 'Открыть список тарифов' }).click();
}
