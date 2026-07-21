import { expect, test, type APIRequestContext } from '@playwright/test';
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

	test('shows an incognito identity and an invitation to buy without a session', async ({
		page
	}) => {
		await page.goto('/profile');

		await expect(page.getByRole('heading', { name: 'Профиль', level: 1 })).toBeVisible();
		await expect(page.getByText('Инкогнито')).toBeVisible();
		await expect(page.getByText('@')).toHaveCount(0);
		await expect(page.getByText('Подписки нет')).toBeVisible();
	});
});

/**
 * The other public Telegram path (tech.md 9). It carries no session and authenticates itself with
 * the header Telegram echoes from `setWebhook`, so the check IS the endpoint's security — hence a
 * test that asserts the refusal, not only the happy path.
 *
 * The secret is the throwaway from .env.test, the same file `vite build` inlined into the preview
 * server these suites run against.
 */
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? 'test-webhook-secret';

const postUpdate = (
	request: APIRequestContext,
	update: unknown,
	secret: string | null = WEBHOOK_SECRET
) =>
	request.post('/api/telegram/webhook', {
		headers: {
			'content-type': 'application/json',
			...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret })
		},
		data: update as Record<string, unknown>
	});

const startUpdate = (updateId: number, chatId = 700_000_900) => ({
	update_id: updateId,
	message: { message_id: 1, chat: { id: chatId, type: 'private' }, text: '/start' }
});

test.describe('telegram webhook', () => {
	test('refuses an update whose secret token does not match', async ({ request }) => {
		const response = await postUpdate(request, startUpdate(910_001), 'not-the-secret');

		expect(response.status()).toBe(401);
		expect(await response.json()).toEqual({ code: 'unauthorized' });
	});

	test('refuses an update carrying no secret token at all', async ({ request }) => {
		const response = await postUpdate(request, startUpdate(910_002), null);

		expect(response.status()).toBe(401);
	});

	test('answers /start from a private chat', async ({ request }) => {
		const response = await postUpdate(request, startUpdate(910_003));

		expect(response.status()).toBe(200);
		expect(await response.json()).toEqual({ outcome: 'start' });
	});

	test('answers a redelivery of the same update without a second reply', async ({ request }) => {
		// Telegram redelivers until it gets a 2xx, and update_id is stable across those attempts —
		// so it is the queue's idempotency key. The unique index turns the second enqueue into a
		// no-op (queue.spec.ts), and the caller must still see a plain 200 or Telegram keeps trying.
		const update = startUpdate(910_008);

		expect((await postUpdate(request, update)).status()).toBe(200);

		const redelivery = await postUpdate(request, update);
		expect(redelivery.status()).toBe(200);
		expect(await redelivery.json()).toEqual({ outcome: 'start' });
	});

	test('ignores updates it does not answer', async ({ request }) => {
		// A plain message, a command meant for somebody else, and /start shouted into a group: the
		// bot pushes notifications and answers one command, so all three are the same non-event.
		const cases = [
			{ update_id: 910_004, message: { chat: { id: 1, type: 'private' }, text: 'привет' } },
			{ update_id: 910_005, message: { chat: { id: 1, type: 'private' }, text: '/stop' } },
			{ update_id: 910_006, message: { chat: { id: 1, type: 'group' }, text: '/start' } },
			{ update_id: 910_007 }
		];

		for (const update of cases) {
			const response = await postUpdate(request, update);
			expect(response.status(), JSON.stringify(update)).toBe(200);
			expect(await response.json()).toEqual({ outcome: 'ignored' });
		}
	});

	test('retires a body it cannot read instead of asking Telegram to redeliver it', async ({
		request
	}) => {
		// Signed with our secret and still unreadable. A retry would carry identical bytes, so 200
		// closes it out rather than letting Telegram redeliver the same failure until it gives up.
		const response = await request.post('/api/telegram/webhook', {
			headers: {
				'content-type': 'application/json',
				'x-telegram-bot-api-secret-token': WEBHOOK_SECRET
			},
			data: { update_id: 'not-a-number' }
		});

		expect(response.status()).toBe(200);
		expect(await response.json()).toEqual({ outcome: 'ignored' });
	});
});
