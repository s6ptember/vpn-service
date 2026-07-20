import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN_CHAT_ID, FRAME, hydrated, openBuySheet, signIn, withId } from './helpers';

/**
 * Stage 6, A16 (tech.md 11): the operations half of the panel — recent support requests, jobs that
 * ran out of attempts, and the manual Marzban reconcile.
 *
 * What this suite pins is the screen and its guard, not the reconcile itself: the job's behaviour is
 * covered where it can be observed, in jobs/handlers/marzban-reconcile.spec.ts against a fake panel.
 * Here the question is narrower and only answerable end to end — does the form reach the queue, and
 * does the section refuse everybody who is not the admin.
 */

test.use({ viewport: FRAME });

/**
 * The preview server keeps one SQLite file across runs, so a fixed id would carry state between
 * them. The admin is the exception: `ADMIN_CHAT_ID` is fixed by .env, since admin-ness is derived
 * from it and never stored (tech.md 5).
 */
const RUN = Date.now() % 100_000;
const WRITER = 700_800_000 + RUN;
const STRANGER = 700_900_000 + RUN;
/** Buys, so the reconcile has a subscription to find. Salted: a fixed id would inherit last run's. */
const SUBSCRIBER = 701_000_000 + RUN;
/** Signs in and never buys, so "no subscription" is a fact about this run rather than a guess. */
const FREELOADER = 701_100_000 + RUN;

const PLAN_NAME = '30 дней';
const PLAN_PRICE_MINOR = 499;

/** Shared with FakePayments; it is not a secret, it is a shape (see clients/payments/fake.ts). */
const FAKE_WEBHOOK_SECRET = 'whsec_fake_dev_secret';

/** Provisioning goes through the worker (2s tick) and the client polls every 3s. */
const SETTLE = { timeout: 20_000 };

const section = (page: Page, name: string) =>
	page.getByRole('heading', { name, level: 2, exact: true });

const planCard = (page: Page, name: string) =>
	page.locator('article').filter({ has: page.getByRole('heading', { name, level: 3 }) });

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

const paidEvent = (publicId: string) => ({
	kind: 'paid',
	eventId: `evt_e2e6_${publicId}_${Date.now()}`,
	orderPublicId: publicId,
	sessionId: `cs_fake_${publicId}`,
	paymentIntentId: `pi_fake_${publicId}`,
	amountMinor: PLAN_PRICE_MINOR,
	currency: 'usd'
});

/**
 * Walks one purchase to completion, so the reconcile below has a real subscription to find. The
 * shape is stage 3's and stage 4's; only the plan and the absence of a promo code differ.
 */
async function subscribe(page: Page, request: APIRequestContext): Promise<void> {
	await captureCheckoutLinks(page);
	await page.goto('/');
	await openBuySheet(page);

	await planCard(page, PLAN_NAME)
		.getByRole('button', { name: new RegExp(`тариф ${PLAN_NAME}`) })
		.click();

	await expect.poll(() => openedLinks(page)).toHaveLength(1);
	const [url] = await openedLinks(page);
	const publicId = url.split('/').pop()!;

	// tech.md 10: the webhook is the only thing that grants access. The redirect is not a fact.
	const paid = await request.post('/api/stripe/webhook', {
		headers: { 'content-type': 'application/json', 'stripe-signature': FAKE_WEBHOOK_SECRET },
		data: paidEvent(publicId)
	});
	expect(await paid.json()).toEqual({ outcome: 'paid' });

	await expect(page.getByText('Готово')).toBeVisible(SETTLE);
}

test.describe('the operations panel', () => {
	test('shows the admin the three operational sections', async ({ page, request }) => {
		await signIn(page, request, withId(ADMIN_CHAT_ID));
		await page.goto('/profile/admin');
		await hydrated(page);

		await expect(section(page, 'Обращения')).toBeVisible();
		await expect(section(page, 'Упавшие джобы')).toBeVisible();
		await expect(section(page, 'Сверка с Marzban')).toBeVisible();
	});

	/**
	 * A request written on one screen has to turn up on the other. This is the only place the two
	 * halves of A14 and A16 meet, and the excerpt is what proves the list read the row rather than
	 * merely rendering an empty state.
	 */
	test('lists a request somebody just sent', async ({ page, request, browser }) => {
		const written = `Не подключается на Android, ключ импортировал сегодня. ${RUN}`;

		const writerContext = await browser.newContext({ viewport: FRAME });
		const writerPage = await writerContext.newPage();
		await signIn(writerPage, writerContext.request, withId(WRITER));
		await writerPage.goto('/support');
		await hydrated(writerPage);
		await writerPage.getByLabel('Ваше обращение').fill(written);
		await writerPage.getByRole('button', { name: 'Отправить обращение' }).click();
		await expect(writerPage.getByText('Отправили', { exact: false })).toBeVisible();
		await writerContext.close();

		await signIn(page, request, withId(ADMIN_CHAT_ID));
		await page.goto('/profile/admin');
		await hydrated(page);

		await expect(page.getByText(written.slice(0, 60), { exact: false })).toBeVisible();
	});

	/**
	 * The one path only an end-to-end test can prove: a Telegram id typed into the panel resolves to
	 * a person, finds their subscription, and reaches the queue. Everything the job then does is
	 * pinned against a fake panel in jobs/handlers/marzban-reconcile.spec.ts.
	 *
	 * The subscriber is bought fresh in this run rather than assumed, because the preview server
	 * keeps one SQLite file across runs — asking about a fixed id would pass or fail depending on
	 * what an earlier run happened to leave behind.
	 */
	test('queues a reconcile for a person who has a subscription', async ({
		page,
		request,
		browser
	}) => {
		const buyerContext = await browser.newContext({ viewport: FRAME });
		const buyerPage = await buyerContext.newPage();
		await signIn(buyerPage, buyerContext.request, withId(SUBSCRIBER));
		await subscribe(buyerPage, buyerContext.request);
		await buyerContext.close();

		await signIn(page, request, withId(ADMIN_CHAT_ID));
		await page.goto('/profile/admin');
		await hydrated(page);

		await page.getByLabel('Telegram ID').fill(String(SUBSCRIBER));
		await page.getByRole('button', { name: 'Сверить с Marzban' }).click();

		await expect(page.getByText('Сверка поставлена в очередь', { exact: false })).toBeVisible();
	});

	/** Somebody the app knows, who has never bought anything: there is nothing to reconcile. */
	test('says there is nothing to sync for a person with no subscription', async ({
		page,
		request,
		browser
	}) => {
		const context = await browser.newContext({ viewport: FRAME });
		await signIn(await context.newPage(), context.request, withId(FREELOADER));
		await context.close();

		await signIn(page, request, withId(ADMIN_CHAT_ID));
		await page.goto('/profile/admin');
		await hydrated(page);

		await page.getByLabel('Telegram ID').fill(String(FREELOADER));
		await page.getByRole('button', { name: 'Сверить с Marzban' }).click();

		await expect(page.getByText('нет подписки', { exact: false })).toBeVisible();
	});

	test('names the refusal when the Telegram id belongs to nobody', async ({ page, request }) => {
		await signIn(page, request, withId(ADMIN_CHAT_ID));
		await page.goto('/profile/admin');
		await hydrated(page);

		await page.getByLabel('Telegram ID').fill('999999999');
		await page.getByRole('button', { name: 'Сверить с Marzban' }).click();

		await expect(page.getByText('такого человека нет', { exact: false })).toBeVisible();
	});

	test('refuses an id that is not a number, without reaching the queue', async ({
		page,
		request
	}) => {
		await signIn(page, request, withId(ADMIN_CHAT_ID));
		await page.goto('/profile/admin');
		await hydrated(page);

		await page.getByLabel('Telegram ID').fill('не число');
		await page.getByRole('button', { name: 'Сверить с Marzban' }).click();

		await expect(page.getByText('Telegram ID: введите число', { exact: false })).toBeVisible();
	});

	// --- the guard (tech.md 9) --------------------------------------------------------------------

	/**
	 * The panel lists support requests and a queue's failure history. tech.md 9 puts a 403 in front
	 * of a signed-in non-admin, and this is the section where being wrong about that leaks other
	 * people's messages.
	 */
	test('answers 403 to somebody who is signed in but not the admin', async ({ page, request }) => {
		await signIn(page, request, withId(STRANGER));

		const response = await page.goto('/profile/admin');

		expect(response?.status()).toBe(403);
	});

	/** The first document GET arrives without a cookie by definition, so the shell must still render. */
	test('renders the shell for a request that has no session yet', async ({ page }) => {
		const response = await page.goto('/profile/admin');

		expect(response?.status()).toBe(200);
	});
});
