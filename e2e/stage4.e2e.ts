import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN_CHAT_ID, FRAME, hydrated, openBuySheet, signIn, withId } from './helpers';

/**
 * Stage 4 end to end (tech.md 14): a promo code checked in Профиль, spent on a purchase from
 * Главная, and the receipt that purchase leaves behind.
 *
 * The path a customer actually walks, against the seeded shop: START30 is 30% off with no usage
 * limit, and the 30-day plan is 499 minor units — so the order Stripe is asked to charge must be 350,
 * and the webhook that grants access must agree with it. That agreement is the point of the test:
 * `PaymentWebhookService` refuses a payment whose amount does not match the order, so a discount
 * applied in one place and forgotten in another fails here rather than in production.
 */

test.use({ viewport: FRAME });

/** Shared with FakePayments; it is not a secret, it is a shape (see clients/payments/fake.ts). */
const FAKE_WEBHOOK_SECRET = 'whsec_fake_dev_secret';

const PLAN_NAME = '30 дней';
const PLAN_PRICE_MINOR = 499;
/** The seeded percentage code, and what it leaves of the plan price after rounding down. */
const PROMO_CODE = 'START30';
const DISCOUNTED_MINOR = 350;

/** Provisioning goes through the worker (2s tick) and the client polls every 3s. */
const SETTLE = { timeout: 20_000 };

/**
 * A promo code may be spent once per person, for good (tech.md 10), and the preview server keeps one
 * SQLite file across runs. So this suite cannot reuse a fixed Telegram id the way the earlier stages
 * do: the second run would find the code already claimed by the first and fail on a rule that is
 * working exactly as designed. One salt per run gives every run its own customers and its own code.
 */
const RUN = Date.now() % 100_000;
const BUYER = 700_100_000 + RUN;
const STRANGER = 700_200_000 + RUN;
const GUESSER = 700_300_000 + RUN;
const OUTSIDER = 700_400_000 + RUN;
const MINTED_CODE = `E2E-${RUN}`;

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

const paidEvent = (publicId: string, amountMinor: number) => ({
	kind: 'paid',
	eventId: `evt_e2e_${publicId}_${Date.now()}`,
	orderPublicId: publicId,
	sessionId: `cs_fake_${publicId}`,
	paymentIntentId: `pi_fake_${publicId}`,
	amountMinor,
	currency: 'usd'
});

const postWebhook = (request: APIRequestContext, body: unknown) =>
	request.post('/api/stripe/webhook', {
		headers: { 'content-type': 'application/json', 'stripe-signature': FAKE_WEBHOOK_SECRET },
		data: body
	});

/** Types a code into the promo sheet and buys the plan; returns the order's public id. */
async function buyWithPromo(page: Page, code: string | null): Promise<string> {
	if (code !== null) {
		await page.getByRole('button', { name: 'Ввести промокод' }).click();
		// getByLabel would also match the sheet itself — its own accessible name is the title,
		// "Промокод", by way of aria-labelledby — so the role narrows it to the actual field.
		await page.getByRole('textbox', { name: 'Промокод' }).fill(code);
		await page.getByRole('button', { name: 'Готово' }).click();
	}

	await openBuySheet(page);
	await planCard(page, PLAN_NAME)
		.getByRole('button', { name: new RegExp(`тариф ${PLAN_NAME}`) })
		.click();

	await expect.poll(() => openedLinks(page)).toHaveLength(1);

	const [url] = await openedLinks(page);
	return url.split('/').pop()!;
}

test.describe.serial('buying with a promo code', () => {
	test('checks a code in the profile, spends it on the deck, and keeps the receipt', async ({
		page,
		request
	}) => {
		await signIn(page, request, withId(BUYER));
		await captureCheckoutLinks(page);

		// --- A10: does this code work? --------------------------------------------------------
		await page.goto('/profile');
		await hydrated(page);

		await page.getByLabel('Промокод').fill('start30');
		await page.getByRole('button', { name: 'Применить' }).click();

		// What the CODE is worth, not what a purchase will cost: the price depends on the plan.
		await expect(page.getByText(/Промокод START30 работает/)).toBeVisible();

		// --- A10: the purchase carries it (tech.md 10, step 1) --------------------------------
		await page.goto('/');
		await hydrated(page);

		const publicId = await buyWithPromo(page, PROMO_CODE);
		await expect(page.getByText('Ждём оплату')).toBeVisible();

		/**
		 * The discount has to have reached the provider, not merely the order row. FakePayments is
		 * the seam that proves it (tech.md 8): it holds what it was actually asked to charge and
		 * refuses any event contradicting it, so an event for the FULL price is thrown out before the
		 * webhook service is reached at all. Had the checkout quoted 499, this would have been accepted.
		 */
		const wrongAmount = await postWebhook(request, paidEvent(publicId, PLAN_PRICE_MINOR));
		expect(await wrongAmount.json()).toEqual({ outcome: 'unusable' });

		const paid = await postWebhook(request, paidEvent(publicId, DISCOUNTED_MINOR));
		expect(await paid.json()).toEqual({ outcome: 'paid' });

		await expect(page.getByText('Готово')).toBeVisible(SETTLE);

		// --- A12: the receipt ------------------------------------------------------------------
		await page.getByRole('link', { name: 'Открыть профиль' }).click();
		await expect(page.getByRole('heading', { name: 'История покупок' })).toBeVisible();

		const receipt = page.getByRole('listitem').first();
		await expect(receipt).toContainText(PLAN_NAME);
		// 350 minor units, formatted by Money.svelte — the discounted price, not the list price.
		await expect(receipt).toContainText('3,50');
	});

	test('refuses the same code a second time instead of discounting twice', async ({
		page,
		request
	}) => {
		// tech.md 10: one code, one application per person. The same person as above.
		await signIn(page, request, withId(BUYER));
		await captureCheckoutLinks(page);

		await page.goto('/');
		await hydrated(page);

		await page.getByRole('button', { name: 'Ввести промокод' }).click();
		await page.getByRole('textbox', { name: 'Промокод' }).fill(PROMO_CODE);
		await page.getByRole('button', { name: 'Готово' }).click();

		await openBuySheet(page);
		await planCard(page, PLAN_NAME)
			.getByRole('button', { name: new RegExp(`тариф ${PLAN_NAME}`) })
			.click();

		await expect(page.getByRole('alert')).toContainText('уже применили');
		// Refused, not quietly sold at full price: nobody is charged for a purchase they did not agree to.
		expect(await openedLinks(page)).toHaveLength(0);
	});

	test('says what is wrong with a code nobody minted', async ({ page, request }) => {
		await signIn(page, request, withId(STRANGER));
		await page.goto('/profile');
		await hydrated(page);

		await page.getByLabel('Промокод').fill('NOSUCHCODE');
		await page.getByRole('button', { name: 'Применить' }).click();

		await expect(page.getByText('Такого промокода нет. Проверьте, как он написан.')).toBeVisible();
	});

	test('stops guessing after five refusals (CLAUDE.md 2)', async ({ page, request }) => {
		await signIn(page, request, withId(GUESSER));
		await page.goto('/profile');
		await hydrated(page);

		const field = page.getByLabel('Промокод');
		const apply = page.getByRole('button', { name: 'Применить' });

		// Five wrong guesses spend the budget; the sixth is refused before the lookup happens.
		for (let attempt = 0; attempt < 5; attempt++) {
			await field.fill(`GUESS${attempt}`);
			await apply.click();
			await expect(
				page.getByText('Такого промокода нет. Проверьте, как он написан.')
			).toBeVisible();
		}

		await field.fill('GUESS5');
		await apply.click();

		await expect(page.getByText(/Слишком много попыток/)).toBeVisible();
	});
});

test.describe('managing promo codes', () => {
	test('creates a code in the admin and sells with it', async ({ page, request }) => {
		await signIn(page, request, withId(ADMIN_CHAT_ID));
		await captureCheckoutLinks(page);

		await page.goto('/profile/admin');
		await hydrated(page);

		await page.getByRole('button', { name: 'Создать промокод' }).click();

		const form = page.locator('form[action="?/createPromo"]');
		// Typed lowercase on purpose: the column holds codes UPPERCASE (tech.md 5), and a code minted
		// any other way would simply be unreachable from the customer's field.
		await form.getByLabel('Код', { exact: true }).fill(MINTED_CODE.toLowerCase());
		await form.getByLabel('Тип скидки').selectOption('percent');
		await form.getByLabel('Скидка, %').fill('50');
		await form.getByRole('button', { name: 'Создать промокод' }).click();

		const card = page
			.locator('article, div')
			.filter({ has: page.getByRole('heading', { name: MINTED_CODE, level: 3 }) })
			.first();
		await expect(card).toContainText('−50%');
		await expect(card).toContainText('0 / ∞');

		// And it works where it is meant to: half of 499, rounded down.
		await page.goto('/');
		await hydrated(page);

		const publicId = await buyWithPromo(page, MINTED_CODE);
		const paid = await postWebhook(request, paidEvent(publicId, 250));
		expect(await paid.json()).toEqual({ outcome: 'paid' });
	});

	test('keeps the promo list away from anybody who is not the admin', async ({ page, request }) => {
		// tech.md 9: the guard 403s a signed-in non-admin. A live code is a bearer secret.
		await signIn(page, request, withId(OUTSIDER));

		const response = await page.goto('/profile/admin');

		expect(response?.status()).toBe(403);
	});
});
