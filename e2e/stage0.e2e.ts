import { expect, test } from '@playwright/test';

/**
 * Stage 0's acceptance criteria, encoded. tech.md 14's full journey (initData → session → payment →
 * QR) cannot exist yet — it belongs to A1 and A5..A9 — so this covers exactly what the skeleton
 * claims: the reference slice reads plans, the island and swipe move between three sections, and the
 * guard tells a cookieless GET apart from a cookieless mutation.
 *
 * These run against the production build, which is the only place the dev-only route guard is real.
 */

const FRAME = { width: 430, height: 880 };

test.use({ viewport: FRAME });

/**
 * The splash is server-rendered and detaches once the client session settles, so its absence means
 * the app has hydrated and Swipeable's pointer listeners are attached. Dragging before that races
 * hydration and fails at random.
 */
async function ready(page: import('@playwright/test').Page) {
	await expect(page.locator('[data-splash]')).toHaveCount(0);
}

test.describe('reference slice: plans, read-only', () => {
	test('renders every seeded plan with a server-rendered price', async ({ page }) => {
		await page.goto('/');

		await expect(page.getByRole('heading', { name: 'Тарифы', level: 1 })).toBeVisible();

		for (const name of ['7 дней', '30 дней', '90 дней']) {
			await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible();
		}

		// Money is the only formatter; a price on screen proves the DTO reached it.
		await expect(page.getByText('1,49 $').first()).toBeVisible();
		await expect(page.getByText('10,49 $').first()).toBeVisible();
	});

	test('serves the list without a session, since plans are public', async ({ request }) => {
		const response = await request.get('/');
		expect(response.status()).toBe(200);
		expect(await response.text()).toContain('Тарифы');
	});
});

test.describe('island', () => {
	test('navigates between all three sections and marks the active one', async ({ page }) => {
		await page.goto('/');
		await ready(page);
		await expect(page.getByRole('link', { name: 'Главная' })).toHaveAttribute(
			'aria-current',
			'page'
		);

		await page.getByRole('link', { name: 'Профиль' }).click();
		await expect(page).toHaveURL('/profile');
		await expect(page.getByRole('heading', { name: 'Профиль', level: 1 })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Профиль' })).toHaveAttribute(
			'aria-current',
			'page'
		);

		await page.getByRole('link', { name: 'Поддержка' }).click();
		await expect(page).toHaveURL('/support');
		await expect(page.getByRole('heading', { name: 'Поддержка', level: 1 })).toBeVisible();

		await page.getByRole('link', { name: 'Главная' }).click();
		await expect(page).toHaveURL('/');
	});

	test('keeps the pill inside the frame rather than the viewport', async ({ page }) => {
		await page.goto('/');

		// The mock nests the island in the 430px frame. `fixed` would measure off the viewport and
		// drop it out of the frame on a desktop-sized window.
		const nav = page.getByRole('navigation', { name: 'Разделы' });
		const navBox = await nav.boundingBox();
		expect(navBox).not.toBeNull();
		expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(FRAME.height + 1);
	});
});

test.describe('swipe', () => {
	test('commits past the 60px threshold and lands on the next section', async ({ page }) => {
		await page.goto('/');
		await ready(page);

		// Drag right-to-left: Главная (1) → Профиль (2).
		await page.mouse.move(FRAME.width - 60, 400);
		await page.mouse.down();
		for (let x = FRAME.width - 60; x >= 100; x -= 20) {
			await page.mouse.move(x, 400);
		}
		await page.mouse.up();

		await expect(page).toHaveURL('/profile');
	});

	test('ignores a short, slow drag that is neither far enough nor a flick', async ({ page }) => {
		await page.goto('/');
		await ready(page);

		// Deliberately slow: tech.md 11 commits on distance OR throw, so a short drag only stays put
		// when its velocity is under 0.4 px/ms too. The pause before lifting also lets the throw go
		// stale, which is what a finger that stops before releasing actually does.
		await page.mouse.move(300, 400);
		await page.mouse.down();
		for (const x of [290, 280, 270, 260]) {
			await page.mouse.move(x, 400);
			await page.waitForTimeout(120);
		}
		await page.waitForTimeout(200);
		await page.mouse.up();

		await expect(page).toHaveURL('/');
	});
});

test.describe('guard', () => {
	test('renders the shell for a cookieless document GET', async ({ request }) => {
		// The first GET never carries initData, so a 401 here would lock everyone out of the app.
		expect((await request.get('/')).status()).toBe(200);
		expect((await request.get('/profile')).status()).toBe(200);
		expect((await request.get('/support')).status()).toBe(200);
	});

	test('rejects a cookieless mutation and a cookieless api call', async ({ request }) => {
		expect((await request.post('/')).status()).toBe(401);
		expect((await request.get('/api/anything')).status()).toBe(401);
	});
});

test.describe('dev-only routes', () => {
	test('kitchen sink is not reachable in a production build', async ({ request }) => {
		expect((await request.get('/dev/kitchen-sink')).status()).toBe(404);
	});
});
