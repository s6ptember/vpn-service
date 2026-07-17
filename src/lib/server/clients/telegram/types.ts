/**
 * Intentionally narrow: v1 only pushes outbound notifications (subscription link, expiry
 * reminders, support relay to the admin). Inbound updates arrive at the webhook route, so the
 * client needs no getUpdates, no media, no inline queries. Widen it when a slice needs more.
 * Field names mirror the Bot API payload, hence snake_case.
 */
export interface SendOptions {
	parse_mode?: 'HTML' | 'MarkdownV2';
	disable_notification?: boolean;
	reply_markup?: unknown;
}

export interface TelegramApi {
	sendMessage(chatId: number, text: string, options?: SendOptions): Promise<{ messageId: number }>;
}

/** Bot API caps a single message at 4096 characters. */
export const MAX_MESSAGE_LENGTH = 4096;
