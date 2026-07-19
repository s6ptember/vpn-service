import { expect, test } from '@playwright/test';
import { FRAME, exchange, sessionCookie, signIn, signedInitData, withId } from './helpers';

/**
 * Stage 1's acceptance criteria end to end: initData becomes a session cookie (A1), and the profile
 * shows who is signed in (A2). tech.md 14's full journey adds payment and QR to this file's path as
 * A5..A9 land.
 *
 * The signing and sign-in helpers live in ./helpers.ts — every stage from A1 on starts by getting a
 * session, and a second copy of Telegram's algorithm would be a second place to get it wrong.
 */

test.use({ viewport: FRAME });

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
