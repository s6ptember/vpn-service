import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { FRAME, hydrated, openBuySheet, signIn, withId } from './helpers';

/**
 * Stage 3 end to end (tech.md 14): initData -> session -> purchase through the fake provider ->
 * webhook -> subscription, link and QR in the profile.
 *
 * The payment is driven by posting the event Stripe would have sent to our own webhook, exactly as
 * `FakePayments.simulatePaid` does from the dev page. That page itself is unreachable here —
 * hooks.server.ts 404s everything under /dev outside `vite dev`, and this suite runs against a
 * production build — so the same path is walked over HTTP instead, which also exercises the real
 * route, the real signature check and the real dedupe.
 */

test.use({ viewport: FRAME });

/** Shared with FakePayments; it is not a secret, it is a shape (see clients/payments/fake.ts). */
const FAKE_WEBHOOK_SECRET = 'whsec_fake_dev_secret';

/** The seeded 30-day plan. The server prices the order, so this is what must be paid. */
const PLAN_NAME = '30 дней';
const PLAN_PRICE_MINOR = 499;

/** Provisioning goes through the worker (2s tick) and the client polls every 3s. */
const SETTLE = { timeout: 20_000 };

/**
 * One salt per run, for the same reason stage 4 carries one: the preview server keeps a single
 * SQLite file across runs, and `foldTerms` folds EVERY paid order of a person into their end date.
 * A fixed id therefore reads "Осталось 30 дней" on a fresh database, 60 on the second run and 90 on
 * the third — the suite would pass once and then fail forever on a rule working exactly as designed.
 *
 * BUYER is deliberately shared by the two tests in the serial block below: the second one asserts
 * that a second purchase EXTENDS the first (tech.md 17.3), which needs the same person. The salt
 * isolates runs from each other, not tests from each other.
 */
const RUN = Date.now() % 100_000;
const BUYER = 701_300_000 + RUN;
const UNDERPAYER = 701_400_000 + RUN;
const VISITOR = 701_500_000 + RUN;

/**
 * There is no Telegram bridge in a plain browser, so `openExternal` falls back to window.open.
 * Stubbing it keeps the run from spawning tabs and hands us the publicId, which lives in the
 * checkout url and nowhere else the client can see.
 */
async function captureCheckoutLinks(page: Page) {
	await page.addInitScript(() => {
		(window as unknown as { __opened: string[] }).__opened = [];
		window.open = (url?: string | URL) => {
			(window as unknown as { __opened: string[] }).__opened.push(String(url));
			return {} as Window;
		};
	});
}

const openedLinks = (page: Page) =>
	page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

const planCard = (page: Page, name: string) =>
	page.locator('article').filter({ has: page.getByRole('heading', { name, level: 3 }) });

/** The event a paid Stripe session would produce, in our own PaymentEvent shape. */
const paidEvent = (publicId: string, overrides: Record<string, unknown> = {}) => ({
	kind: 'paid',
	eventId: `evt_e2e_${publicId}_${Date.now()}`,
	orderPublicId: publicId,
	// FakePayments mints session ids from the publicId and refuses an event that contradicts it.
	sessionId: `cs_fake_${publicId}`,
	paymentIntentId: `pi_fake_${publicId}`,
	amountMinor: PLAN_PRICE_MINOR,
	currency: 'usd',
	...overrides
});

const postWebhook = (request: APIRequestContext, body: unknown, signature = FAKE_WEBHOOK_SECRET) =>
	request.post('/api/stripe/webhook', {
		headers: { 'content-type': 'application/json', 'stripe-signature': signature },
		data: body
	});

/**
 * Buys a plan and returns the publicId of the order it opened.
 *
 * Opens the deck sheet itself, but only when it is not open already: once it is, its own backdrop
 * sits on top of Открыть список тарифов — a second click there would hang waiting for a button a
 * caller that opened the sheet first (to check the "Продлит доступ до" line, say) cannot reach.
 */
async function startCheckout(page: Page, planName = PLAN_NAME): Promise<string> {
	const buyButton = planCard(page, planName).getByRole('button', {
		name: `Купить тариф ${planName}`
	});

	if (!(await buyButton.isVisible())) {
		await page.getByRole('button', { name: 'Открыть список тарифов' }).click();
	}

	await buyButton.click();

	await expect.poll(() => openedLinks(page)).toHaveLength(1);

	const [url] = await openedLinks(page);
	const publicId = url.split('/').pop()!;
	expect(publicId, 'the checkout url carries the order public id').toBeTruthy();

	return publicId;
}

test.describe.serial('buying a subscription', () => {
	test('pays for a plan and gets a working key in the profile', async ({ page, request }) => {
		await signIn(page, request, withId(BUYER));
		await captureCheckoutLinks(page);

		await page.goto('/');
		await hydrated(page);

		// --- checkout ------------------------------------------------------------------------
		const publicId = await startCheckout(page);

		// The mini app stays open behind the browser and says what it is waiting for (tech.md 10).
		await expect(page.getByText('Ждём оплату')).toBeVisible();

		// --- the webhook is the only thing that grants access (tech.md 10, step 7) -------------
		const response = await postWebhook(request, paidEvent(publicId));
		expect(response.status()).toBe(200);
		expect(await response.json()).toEqual({ outcome: 'paid' });

		// The client polls invalidate('app:subscription') until the key exists — not merely until
		// the order says paid, which happens a worker tick earlier.
		await expect(page.getByText('Готово')).toBeVisible(SETTLE);
		await expect(page.getByText('Ключ и QR-код ждут вас в профиле.')).toBeVisible();

		// --- the profile (A9) ------------------------------------------------------------------
		await page.getByRole('link', { name: 'Открыть профиль' }).click();

		await expect(page.getByRole('heading', { name: 'Профиль', level: 1 })).toBeVisible();
		// First on the page, which is the subscription card: A12 put a purchase history below it, and
		// every receipt in that list names a plan too.
		await expect(page.getByText(PLAN_NAME, { exact: true }).first()).toBeVisible();
		await expect(page.getByText('Осталось 30 дней')).toBeVisible();
		await expect(page.getByText(/Действует до/)).toBeVisible();

		// The key itself: a link to copy and a QR to scan from another device.
		await expect(page.getByRole('img', { name: 'QR-код подписки' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Скопировать: Ссылка подписки' })).toBeVisible();
		await expect(page.getByText(`/sub/tg_${BUYER}`)).toBeVisible();

		// And the invitation to buy is gone, because there is nothing left to buy.
		await expect(page.getByText('Подписки нет')).toHaveCount(0);
	});

	test('adds the days of a second purchase to the first', async ({ page, request }) => {
		// tech.md 17.3: buying again extends, it never resets. Same person as above.
		await signIn(page, request, withId(BUYER));
		await captureCheckoutLinks(page);

		await page.goto('/');
		await openBuySheet(page);

		// With access live, the card sells an extension rather than a start.
		const card = planCard(page, PLAN_NAME);
		await expect(card.getByText(/Продлит доступ до/)).toBeVisible();

		const publicId = await startCheckout(page);
		const event = paidEvent(publicId);
		expect((await postWebhook(request, event)).status()).toBe(200);

		await expect(page.getByText('Готово')).toBeVisible(SETTLE);

		await page.goto('/profile');
		await hydrated(page);

		// 30 already-paid days plus 30 more.
		await expect(page.getByText('Осталось 60 дней')).toBeVisible(SETTLE);

		// --- and Stripe retries -----------------------------------------------------------------
		// The same event again, then the same payment under a fresh event id. The two barriers are
		// webhookEvents.eventId and orders.providerPaymentIntentId; between them the answer is 60.
		expect(await (await postWebhook(request, event)).json()).toEqual({ outcome: 'duplicate' });
		expect(await (await postWebhook(request, paidEvent(publicId))).json()).toEqual({
			outcome: 'already_paid'
		});

		await page.reload();
		await hydrated(page);
		await expect(page.getByText('Осталось 60 дней')).toBeVisible(SETTLE);
		await expect(page.getByText('Осталось 90 дней')).toHaveCount(0);
	});
});

test.describe('the webhook is the only door', () => {
	test('refuses a body that is not signed', async ({ request }) => {
		const response = await postWebhook(request, paidEvent('whatever'), 'not-the-secret');

		// tech.md 10: signature mismatch answers 400 without a single database call.
		expect(response.status()).toBe(400);
	});

	test('refuses to grant access for an order nobody checked out', async ({ request }) => {
		const response = await postWebhook(request, paidEvent('ord_never_existed'));

		// Signed, and about nothing we ever opened. The fake refuses to even hand it over, and the
		// route answers 200 because no retry could ever make it true.
		expect(response.status()).toBe(200);
		expect(await response.json()).toEqual({ outcome: 'unusable' });
	});

	test('refuses to grant access when the amount does not match the order', async ({
		page,
		request
	}) => {
		await signIn(page, request, withId(UNDERPAYER));
		await captureCheckoutLinks(page);

		await page.goto('/');
		await hydrated(page);

		const publicId = await startCheckout(page);

		// The server priced this at 499. Paying a cent must buy nothing.
		const response = await postWebhook(request, paidEvent(publicId, { amountMinor: 1 }));
		expect(response.status()).toBe(200);
		expect(await response.json()).toEqual({ outcome: 'unusable' });

		await page.goto('/profile');
		await hydrated(page);
		await expect(page.getByText('Подписки нет')).toBeVisible();
		await expect(page.getByRole('img', { name: 'QR-код подписки' })).toHaveCount(0);
	});
});

test.describe('a visitor who has not paid', () => {
	test('sees the plans and no key', async ({ page, request }) => {
		await signIn(page, request, withId(VISITOR));

		await page.goto('/profile');
		await hydrated(page);

		await expect(page.getByText('Подписки нет')).toBeVisible();
		await expect(page.getByRole('img', { name: 'QR-код подписки' })).toHaveCount(0);
		// The empty profile invites a purchase rather than reporting an absence (tech.md 11).
		await expect(page.getByRole('button', { name: 'Выбрать тариф' })).toBeVisible();
	});
});
