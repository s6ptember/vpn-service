import { TelegramError } from '$lib/server/errors';
import { MAX_MESSAGE_LENGTH, type SendOptions, type TelegramApi } from './types';

export interface SentMessage {
	chatId: number;
	text: string;
	options: SendOptions | undefined;
}

export type TelegramFailMode = 'timeout' | 500 | 429;

/** What failNext(429) reports back, so a retry test can assert on a known number. */
export const FAKE_RETRY_AFTER_SEC = 5;

export class FakeTelegram implements TelegramApi {
	/** Outgoing messages, in order. Tests read this instead of the network. */
	readonly sent: SentMessage[] = [];

	#nextMessageId = 1;
	#failNext: TelegramFailMode | null = null;

	async sendMessage(
		chatId: number,
		text: string,
		options?: SendOptions
	): Promise<{ messageId: number }> {
		// The fake is the test seam: garbage must die here, not against the real Bot API.
		if (!Number.isSafeInteger(chatId)) {
			throw new TelegramError(`chatId must be an integer, got ${chatId}`);
		}
		if (text.length === 0 || text.length > MAX_MESSAGE_LENGTH) {
			throw new TelegramError(
				`text must be 1..${MAX_MESSAGE_LENGTH} characters, got ${text.length}`
			);
		}

		const mode = this.#failNext;
		this.#failNext = null;
		if (mode !== null) throw failure(mode);

		this.sent.push({ chatId, text, options });
		return { messageId: this.#nextMessageId++ };
	}

	/** Arms the next call to fail once. Error paths are tested through this, not through mocks. */
	failNext(mode: TelegramFailMode): void {
		this.#failNext = mode;
	}

	reset(): void {
		this.sent.length = 0;
		this.#nextMessageId = 1;
		this.#failNext = null;
	}
}

function failure(mode: TelegramFailMode): TelegramError {
	if (mode === 'timeout') return new TelegramError('sendMessage timed out after 10000ms');
	if (mode === 429) {
		return new TelegramError('Too Many Requests: retry later', {
			status: 429,
			retryAfterSec: FAKE_RETRY_AFTER_SEC
		});
	}
	return new TelegramError('Internal Server Error', { status: 500 });
}
