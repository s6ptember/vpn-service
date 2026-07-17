import * as v from 'valibot';
import type { TelegramApi } from '$lib/server/clients/telegram';
import type { Logger } from '$lib/server/log';
import { JobHandler } from '../handler';

const PayloadSchema = v.object({
	chatId: v.number(),
	text: v.pipe(v.string(), v.minLength(1)),
	dedupeKey: v.pipe(v.string(), v.minLength(1))
});

/** One outgoing message (tech.md 6). Every domain that talks to a person goes through here. */
export class TelegramSendMessageHandler extends JobHandler<'telegram.send_message'> {
	readonly type = 'telegram.send_message';
	readonly schema = PayloadSchema;

	constructor(
		private readonly telegram: TelegramApi,
		private readonly log: Logger
	) {
		super();
	}

	/**
	 * Idempotency lives entirely in the queue key `tg:<dedupeKey>`: one logical message, one row,
	 * enforced by the unique index. There is no local write to make conditional and Bot API has no
	 * idempotency key of its own, so the handler simply sends.
	 *
	 * That leaves one honest gap: a send that succeeds at Telegram but fails on the way back is
	 * retried and delivers twice. Duplicating a notification beats dropping one, so the retry
	 * stays.
	 */
	async handle(payload: v.InferOutput<typeof PayloadSchema>): Promise<void> {
		const { messageId } = await this.telegram.sendMessage(payload.chatId, payload.text);

		// messageId is the only thread back to a delivered message; support.notify_admin stores it.
		this.log.info('telegram.message_sent', {
			chatId: payload.chatId,
			dedupeKey: payload.dedupeKey,
			messageId
		});
	}
}
