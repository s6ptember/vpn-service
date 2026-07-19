import { expect, test, type Page } from '@playwright/test';
import { ADMIN_CHAT_ID, FRAME, hydrated, signIn, withId } from './helpers';

/**
 * Stage 2's acceptance criteria end to end: the home shows the active plans from the DB with their
 * срок and price (A3), and the admin creates, edits and archives them instead of deleting (A4).
 *
 * The preview server keeps one SQLite file for the whole run, so the CRUD journey is one serial
 * test that archives what it created. Its plan is deliberately the worst per-day rate in the deck,
 * which keeps it away from the "best value" ring the other assertions rely on.
 */

test.use({ viewport: FRAME });

/** Unique per run, so a retry never collides with the row the previous attempt left behind. */
const planName = (suffix: string) => `E2E ${suffix} ${Date.now()}`;

/**
 * Every plan carries a collapsed edit form, so the whole page holds one "Название" per row. Scope
 * first, then ask by label — the labels are what a person reads, and the form is what owns them.
 */
const cardFor = (page: Page, name: string) =>
	page.locator('div.rounded-card').filter({ has: page.getByRole('heading', { name, level: 3 }) });

const createForm = (page: Page) => page.locator('form[action="?/create"]');
const editForm = (page: Page, name: string) =>
	cardFor(page, name).locator('form[action="?/update"]');

test.describe('home: plans from the database', () => {
	test('shows every seeded plan with its duration and price', async ({ page }) => {
		await page.goto('/');
		await hydrated(page);

		await expect(page.getByRole('heading', { name: 'Тарифы', level: 1 })).toBeVisible();

		// tech.md 11 puts имя, срок and цена on the card. The name is free text, so the duration has
		// to be written out rather than read out of it.
		for (const [name, days, price] of [
			['7 дней', 'Доступ на 7 дней', '1,49'],
			['30 дней', 'Доступ на 30 дней', '4,99'],
			['90 дней', 'Доступ на 90 дней', '10,49']
		]) {
			await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible();
			await expect(page.getByText(days)).toBeVisible();
			await expect(page.getByText(price, { exact: false }).first()).toBeVisible();
		}

		// The seed prices 90 days well under three months of the 7-day rate, so it takes the badge.
		await expect(page.getByText('Выгоднее всего')).toBeVisible();
		await expect(page.getByText('Безлимитный трафик').first()).toBeVisible();
	});

	test('serves the plans to a visitor with no session at all', async ({ page }) => {
		// Plans are public: the load has to survive locals.user === null (tech.md 9).
		await page.goto('/');

		await expect(page.getByRole('heading', { name: '30 дней', level: 3 })).toBeVisible();
	});
});

test.describe('admin access', () => {
	test('hides the entrance from an ordinary person and refuses the page too', async ({
		page,
		request
	}) => {
		await signIn(page, request, withId(700_000_201));

		await page.goto('/profile');
		await hydrated(page);
		await expect(page.getByText('Админка')).toHaveCount(0);

		// The hidden link is decoration; the guard is what refuses (tech.md 9).
		const response = await page.goto('/profile/admin');
		expect(response?.status()).toBe(403);
	});

	test('refuses an ordinary person who posts the action directly', async ({ page, request }) => {
		await signIn(page, request, withId(700_000_202));

		const cookie = (await page.context().cookies()).find((c) => c.name === 'session');
		const response = await request.post('/profile/admin?/archive', {
			headers: { cookie: `session=${cookie!.value}`, origin: 'http://localhost:4173' },
			form: { id: '1' }
		});

		// The guard in handle answers first; either way the write must not happen.
		expect(response.status()).toBeGreaterThanOrEqual(400);
	});

	test('lets the admin in', async ({ page, request }) => {
		await signIn(page, request, withId(ADMIN_CHAT_ID));

		await page.goto('/profile');
		await hydrated(page);

		await page.getByRole('link', { name: 'Админка' }).click();

		await expect(page.getByRole('heading', { name: 'Админка', level: 1 })).toBeVisible();
	});
});

test.describe.serial('admin: plan CRUD', () => {
	test('creates, edits and archives a plan, and the home follows along', async ({
		page,
		request
	}) => {
		const created = planName('создан');
		const renamed = planName('переименован');

		await signIn(page, request, withId(ADMIN_CHAT_ID));
		await page.goto('/profile/admin');
		await hydrated(page);

		// --- create -------------------------------------------------------------------------
		await page.getByRole('button', { name: 'Создать тариф' }).click();

		const form = createForm(page);
		await form.getByLabel('Название').fill(created);
		await form.getByLabel('Подпись на карточке').fill('Только для теста');
		await form.getByLabel('Срок, дней').fill('1');
		await form.getByLabel('Цена, минорные единицы').fill('9999');
		await form.getByLabel('Трафик, ГБ').fill('10');
		await form.getByLabel('Порядок').fill('99');

		// The form previews what the customer will read, so nobody types dollars into a cents field.
		await expect(form.getByText('99,99')).toBeVisible();

		await form.getByRole('button', { name: 'Создать тариф' }).click();

		await expect(page.getByText(`Тариф «${created}» создан.`)).toBeVisible();
		await expect(page.getByRole('heading', { name: created, level: 3 })).toBeVisible();

		// The server owns the price and the currency: 9999 minor units is what the customer sees.
		await page.goto('/');
		await expect(page.getByRole('heading', { name: created, level: 3 })).toBeVisible();
		await expect(page.getByText('10 ГБ трафика')).toBeVisible();
		await expect(page.getByText('Доступ на 1 день')).toBeVisible();

		// --- edit ---------------------------------------------------------------------------
		await page.goto('/profile/admin');
		await hydrated(page);

		await cardFor(page, created).getByText('Изменить').click();

		const edit = editForm(page, created);
		await edit.getByLabel('Название').fill(renamed);
		await edit.getByRole('button', { name: 'Сохранить' }).click();

		await expect(page.getByText(`Тариф «${renamed}» сохранён.`)).toBeVisible();

		// --- validation ---------------------------------------------------------------------
		const renamedEdit = editForm(page, renamed);
		await renamedEdit.getByLabel('Цена, минорные единицы').fill('1');
		await renamedEdit.getByRole('button', { name: 'Сохранить' }).click();

		// tech.md 5: no plan may be priced under what Stripe will actually charge.
		await expect(renamedEdit.getByText(/Цена: не меньше 50/)).toBeVisible();

		// --- archive ------------------------------------------------------------------------
		await page.goto('/profile/admin');
		await hydrated(page);

		await cardFor(page, renamed).getByText('Изменить').click();
		await page.getByRole('button', { name: `Отправить тариф ${renamed} в архив` }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'В архив', exact: true }).click();

		await expect(page.getByText(`Тариф «${renamed}» в архиве.`)).toBeVisible();

		// Archiving is not deleting: the row survives for the orders that reference it, and it is
		// simply gone from both lists.
		await expect(page.getByRole('heading', { name: renamed, level: 3 })).toHaveCount(0);

		await page.goto('/');
		await expect(page.getByRole('heading', { name: renamed, level: 3 })).toHaveCount(0);
		await expect(page.getByRole('heading', { name: '30 дней', level: 3 })).toBeVisible();
	});

	test('keeps a plan off the home while it is hidden, without archiving it', async ({
		page,
		request
	}) => {
		const hidden = planName('вне витрины');

		await signIn(page, request, withId(ADMIN_CHAT_ID));
		await page.goto('/profile/admin');
		await hydrated(page);

		await page.getByRole('button', { name: 'Создать тариф' }).click();

		const form = createForm(page);
		await form.getByLabel('Название').fill(hidden);
		await form.getByLabel('Срок, дней').fill('1');
		await form.getByLabel('Цена, минорные единицы').fill('9999');
		await form.getByLabel('Порядок').fill('99');
		await form.getByLabel('Показывать на главной').uncheck();
		await form.getByRole('button', { name: 'Создать тариф' }).click();

		await expect(page.getByText(`Тариф «${hidden}» создан.`)).toBeVisible();
		// isActive is a reversible toggle, so the admin still sees it — the customer does not.
		await expect(cardFor(page, hidden).getByText('Скрыт', { exact: true })).toBeVisible();

		await page.goto('/');
		await expect(page.getByRole('heading', { name: hidden, level: 3 })).toHaveCount(0);

		// Leave the run as it was found.
		await page.goto('/profile/admin');
		await hydrated(page);
		await cardFor(page, hidden).getByText('Изменить').click();
		await page.getByRole('button', { name: `Отправить тариф ${hidden} в архив` }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'В архив', exact: true }).click();
		await expect(page.getByText(`Тариф «${hidden}» в архиве.`)).toBeVisible();
	});
});
