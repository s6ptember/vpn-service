import { expect, test } from '@playwright/test';
import { FRAME, hydrated, signIn, withId } from './helpers';

/**
 * Stage 5 end to end (tech.md 14): the two halves of Поддержка as somebody actually meets them —
 * an answer read without signing in (A13), and a request written, refused and accepted (A14).
 *
 * What it deliberately does not assert is the Telegram DM itself. The preview server builds for
 * production, so the container wires the real Bot API client against a test token (container.ts):
 * whether that send lands is a fact about the queue and the token, and it is pinned where it can be
 * pinned honestly — against FakeTelegram, in support-notify-admin.spec.ts.
 */

test.use({ viewport: FRAME });

/**
 * Three requests an hour, for good, and the preview server keeps one SQLite file across runs. So
 * this suite cannot reuse a fixed Telegram id the way the earlier stages do: the second run would
 * find the budget already spent by the first and fail on a rule working exactly as designed. One
 * salt per run gives every run its own people.
 */
const RUN = Date.now() % 100_000;
const WRITER = 700_500_000 + RUN;
const TALKER = 700_600_000 + RUN;
const DRAFTER = 700_700_000 + RUN;

const MESSAGE = 'VPN не подключается на iPhone, приложение V2Box. Ключ импортировал вчера.';

test.describe('the FAQ', () => {
	/**
	 * A13 renders from the seeded table with no session at all. Somebody opening Поддержка already
	 * has a problem; an answer that waits for the initData handshake arrives too late.
	 */
	test('answers a common question before anybody signs in', async ({ page }) => {
		await page.goto('/support');

		const question = page.getByRole('heading', { name: 'Как подключиться после оплаты?' });
		await expect(question).toBeVisible();

		// The answer is closed until it is asked for: <details> hides it from sight, not from the DOM.
		const answer = page.getByText(/Ключ появится в профиле сразу после оплаты/);
		await expect(answer).toBeHidden();

		await question.click();
		await expect(answer).toBeVisible();
	});

	/** `name` on the group: opening one answer closes the last, so the list never becomes a wall. */
	test('shows one answer at a time', async ({ page }) => {
		await page.goto('/support');

		await page.getByRole('heading', { name: 'Как подключиться после оплаты?' }).click();
		await page.getByRole('heading', { name: 'Вы ведёте логи?' }).click();

		await expect(page.getByText(/Храним только Telegram ID/)).toBeVisible();
		await expect(page.getByText(/Ключ появится в профиле сразу после оплаты/)).toBeHidden();
	});
});

test.describe('writing to support', () => {
	test('sends a request and says it has arrived', async ({ page, request }) => {
		await signIn(page, request, withId(WRITER));
		await page.goto('/support');
		await hydrated(page);

		await page.getByLabel('Ваше обращение').fill(MESSAGE);
		await page.getByRole('button', { name: 'Отправить обращение' }).click();

		// tech.md 11: "Отправили, админ ответит в личку", and the field is empty for the next one.
		await expect(page.getByText('Отправили', { exact: true })).toBeVisible();
		await expect(page.getByText('Админ ответит вам в личку в Telegram.')).toBeVisible();
		await expect(page.getByLabel('Ваше обращение')).toHaveValue('');
	});

	/**
	 * The confirmation belongs to a message that actually left. Somebody who starts a second request
	 * and then deletes the draft to begin again must not be told their problem has already reached
	 * the admin — an empty field is not proof that anything was sent.
	 */
	test('drops the confirmation once a new request is started, and does not bring it back', async ({
		page,
		request
	}) => {
		await signIn(page, request, withId(DRAFTER));
		await page.goto('/support');
		await hydrated(page);

		const field = page.getByLabel('Ваше обращение');
		const confirmation = page.getByText('Отправили', { exact: true });

		await field.fill(MESSAGE);
		await page.getByRole('button', { name: 'Отправить обращение' }).click();
		await expect(confirmation).toBeVisible();

		await field.fill('Ещё одна проблема: не открывается сайт.');
		await expect(confirmation).toBeHidden();

		await field.fill('');
		await expect(confirmation).toBeHidden();
	});

	/** tech.md 11 puts the floor at ten characters, and the field has to say so rather than refuse
	 *  in silence. The counter alone would leave somebody guessing what the minimum is. */
	test('asks for more than two words instead of forwarding them', async ({ page, request }) => {
		await signIn(page, request, withId(WRITER));
		await page.goto('/support');
		await hydrated(page);

		// Nine characters, one under the floor.
		await page.getByLabel('Ваше обращение').fill('сломалось');
		await page.getByRole('button', { name: 'Отправить обращение' }).click();

		await expect(page.getByText(/не меньше 10 символов/)).toBeVisible();
	});

	/** CLAUDE.md 2: three an hour per person, and the fourth gets a sentence it can act on. */
	test('stops at three requests an hour and names the wait', async ({ page, request }) => {
		await signIn(page, request, withId(TALKER));
		await page.goto('/support');
		await hydrated(page);

		const field = page.getByLabel('Ваше обращение');
		const send = page.getByRole('button', { name: 'Отправить обращение' });

		for (let attempt = 0; attempt < 3; attempt++) {
			await field.fill(`${MESSAGE} Попытка ${attempt}.`);
			await send.click();
			/**
			 * `exact` matters more than it looks: the refusal below opens with «Вы уже отправили», and
			 * a substring match would let a refused submission satisfy the assertion that it was
			 * accepted — leaving this test green at a limit of one.
			 */
			await expect(page.getByText('Отправили', { exact: true })).toBeVisible();
			await expect(page.getByText(/Вы уже отправили/)).toBeHidden();
		}

		await field.fill(`${MESSAGE} И ещё одно.`);
		await send.click();

		await expect(page.getByText(/Вы уже отправили три обращения за час/)).toBeVisible();
	});
});
