import { beforeEach, describe, expect, it } from 'vitest';
import { TelegramError } from '$lib/server/errors';
import { FakeTelegram, FAKE_RETRY_AFTER_SEC } from './fake';
import { MAX_MESSAGE_LENGTH } from './types';

describe('FakeTelegram', () => {
	let telegram: FakeTelegram;

	beforeEach(() => {
		telegram = new FakeTelegram();
	});

	it('records outgoing messages in order with fresh ids', async () => {
		const first = await telegram.sendMessage(555, 'Ссылка на подписку', { parse_mode: 'HTML' });
		const second = await telegram.sendMessage(777, 'Подписка кончается через 3 дня');

		expect(first).toEqual({ messageId: 1 });
		expect(second).toEqual({ messageId: 2 });
		expect(telegram.sent).toEqual([
			{ chatId: 555, text: 'Ссылка на подписку', options: { parse_mode: 'HTML' } },
			{ chatId: 777, text: 'Подписка кончается через 3 дня', options: undefined }
		]);
	});

	it('reports retry_after on 429 so the queue can back off', async () => {
		telegram.failNext(429);

		const error = await telegram.sendMessage(555, 'hi').catch((e: unknown) => e);

		expect(error).toBeInstanceOf(TelegramError);
		expect(error).toMatchObject({ status: 429, retryAfterSec: FAKE_RETRY_AFTER_SEC });
	});

	it('fails exactly once per failNext and sends nothing while failing', async () => {
		telegram.failNext(500);
		await expect(telegram.sendMessage(555, 'hi')).rejects.toThrow(TelegramError);
		expect(telegram.sent).toHaveLength(0);

		await telegram.sendMessage(555, 'hi');
		expect(telegram.sent).toHaveLength(1);
	});

	it('rejects a message the Bot API would reject', async () => {
		await expect(telegram.sendMessage(555, '')).rejects.toThrow(TelegramError);
		await expect(telegram.sendMessage(555, 'x'.repeat(MAX_MESSAGE_LENGTH + 1))).rejects.toThrow(
			TelegramError
		);
		await expect(telegram.sendMessage(1.5, 'hi')).rejects.toThrow(TelegramError);
		expect(telegram.sent).toHaveLength(0);
	});

	it('forgets everything on reset', async () => {
		await telegram.sendMessage(555, 'hi');

		telegram.reset();

		expect(telegram.sent).toHaveLength(0);
		await expect(telegram.sendMessage(555, 'hi')).resolves.toEqual({ messageId: 1 });
	});
});
