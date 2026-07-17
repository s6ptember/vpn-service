import { describe, expect, it } from 'vitest';
import { TelegramError } from '$lib/server/errors';
import { TelegramHttp } from './http';

const TOKEN = '123456:AAHfake-bot-token-value';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

async function errorFrom(promise: Promise<unknown>): Promise<TelegramError> {
	const caught = await promise.then(
		() => null,
		(error: unknown) => error
	);
	if (!(caught instanceof TelegramError)) throw new Error(`expected TelegramError, got ${caught}`);
	return caught;
}

describe('TelegramHttp.sendMessage', () => {
	it('posts to the bot method and returns the message id', async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		const client = new TelegramHttp({
			botToken: TOKEN,
			fetch: async (input, init) => {
				calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
				return jsonResponse({ ok: true, result: { message_id: 77 } });
			}
		});

		const result = await client.sendMessage(555, 'Подписка активна', { parse_mode: 'HTML' });

		expect(result).toEqual({ messageId: 77 });
		expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
		expect(calls[0].body).toEqual({
			chat_id: 555,
			text: 'Подписка активна',
			parse_mode: 'HTML'
		});
	});

	it('omits options the caller did not set', async () => {
		let sent: unknown;
		const client = new TelegramHttp({
			botToken: TOKEN,
			fetch: async (_input, init) => {
				sent = JSON.parse(String(init?.body));
				return jsonResponse({ ok: true, result: { message_id: 1 } });
			}
		});

		await client.sendMessage(555, 'hi');

		expect(sent).toEqual({ chat_id: 555, text: 'hi' });
	});

	it('surfaces retry_after on 429 instead of sleeping on it', async () => {
		const client = new TelegramHttp({
			botToken: TOKEN,
			fetch: async () =>
				jsonResponse(
					{
						ok: false,
						error_code: 429,
						description: 'Too Many Requests: retry after 42',
						parameters: { retry_after: 42 }
					},
					429
				)
		});

		const error = await errorFrom(client.sendMessage(555, 'hi'));

		expect(error.status).toBe(429);
		expect(error.retryAfterSec).toBe(42);
	});

	it('reports a plain failure with the Bot API description', async () => {
		const client = new TelegramHttp({
			botToken: TOKEN,
			fetch: async () =>
				jsonResponse(
					{ ok: false, error_code: 400, description: 'Bad Request: chat not found' },
					400
				)
		});

		const error = await errorFrom(client.sendMessage(555, 'hi'));

		expect(error.message).toBe('Bad Request: chat not found');
		expect(error.status).toBe(400);
		expect(error.retryAfterSec).toBeNull();
	});

	// The contract promises a number. support.notify_admin (tech.md 6) stores that messageId in an
	// integer column, so "ok, but not a Message" has to fail here rather than surface as undefined.
	it('refuses an ok answer that carries no message id', async () => {
		for (const result of [true, {}, { message_id: 'seventy-seven' }, null]) {
			const client = new TelegramHttp({
				botToken: TOKEN,
				fetch: async () => jsonResponse({ ok: true, result })
			});

			await expect(client.sendMessage(555, 'hi')).rejects.toThrow(TelegramError);
		}
	});

	it('reports a timeout with the elapsed time and no retry hint', async () => {
		let clock = 1_000;
		const client = new TelegramHttp({
			botToken: TOKEN,
			now: () => clock,
			fetch: async () => {
				clock += 10_000;
				throw Object.assign(new Error('The operation was aborted due to timeout'), {
					name: 'TimeoutError'
				});
			}
		});

		const error = await errorFrom(client.sendMessage(555, 'hi'));

		expect(error.message).toBe('sendMessage timed out after 10000ms');
		expect(error.retryAfterSec).toBeNull();
	});

	it('never leaks the bot token into an error, whatever went wrong', async () => {
		const responses: Array<() => Response | never> = [
			() => jsonResponse({ ok: false, error_code: 429, parameters: { retry_after: 1 } }, 429),
			() => jsonResponse({ ok: false, error_code: 403, description: TOKEN }, 403),
			() => jsonResponse('<html>gateway</html>', 502),
			() => {
				throw new TypeError(`fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage`);
			}
		];

		for (const respond of responses) {
			const client = new TelegramHttp({ botToken: TOKEN, fetch: async () => respond() });
			const error = await errorFrom(client.sendMessage(555, 'hi'));
			expect(error.message).not.toContain(TOKEN);
		}
	});
});
