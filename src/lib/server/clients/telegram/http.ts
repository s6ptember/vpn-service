import * as v from 'valibot';
import { TelegramError } from '$lib/server/errors';
import type { SendOptions, TelegramApi } from './types';

const API_ORIGIN = 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;

export interface TelegramHttpOptions {
	botToken: string;
	/** Injectable transport: tests drive the client without touching the network. */
	fetch?: typeof globalThis.fetch;
	now?: () => number;
}

/**
 * Envelope every Bot API method answers with. Parsed, not cast: `retry_after` steers the queue's
 * backoff and `result` becomes a messageId that support.notify_admin writes to an integer column,
 * so a body that merely looks right must not walk in behind a type assertion.
 */
const EnvelopeSchema = v.object({
	ok: v.optional(v.boolean()),
	result: v.optional(v.unknown()),
	description: v.optional(v.string()),
	error_code: v.optional(v.number()),
	parameters: v.optional(v.object({ retry_after: v.optional(v.number()) }))
});

type Envelope = v.InferOutput<typeof EnvelopeSchema>;

/** sendMessage answers with a Message. `message_id` is the only field we consume. */
const MessageSchema = v.object({ message_id: v.number() });

export class TelegramHttp implements TelegramApi {
	readonly #botToken: string;
	readonly #fetch: typeof globalThis.fetch;
	readonly #now: () => number;

	constructor(options: TelegramHttpOptions) {
		this.#botToken = options.botToken;
		this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.#now = options.now ?? Date.now;
	}

	async sendMessage(
		chatId: number,
		text: string,
		options?: SendOptions
	): Promise<{ messageId: number }> {
		const payload: Record<string, unknown> = { chat_id: chatId, text };
		if (options?.parse_mode !== undefined) payload.parse_mode = options.parse_mode;
		if (options?.disable_notification !== undefined) {
			payload.disable_notification = options.disable_notification;
		}
		if (options?.reply_markup !== undefined) payload.reply_markup = options.reply_markup;

		const result = await this.#call('sendMessage', payload, MessageSchema);
		return { messageId: result.message_id };
	}

	async #call<TSchema extends v.GenericSchema>(
		method: string,
		payload: Record<string, unknown>,
		schema: TSchema
	): Promise<v.InferOutput<TSchema>> {
		const startedAt = this.#now();
		let response: Response;

		try {
			// The token sits in the path, so this URL is built here and never travels into an error.
			response = await this.#fetch(`${API_ORIGIN}/bot${this.#botToken}/${method}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
		} catch (cause) {
			const elapsedMs = this.#now() - startedAt;
			const timedOut =
				cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
			throw new TelegramError(
				timedOut ? `${method} timed out after ${elapsedMs}ms` : `${method} request failed`,
				{ cause }
			);
		}

		// A body we cannot parse tells us nothing, so it degrades to an empty envelope and the
		// status alone decides. Never to a cast: a 200 that is not the shape we asked for is a
		// failure, not a value.
		const parsed = v.safeParse(EnvelopeSchema, await response.json().catch(() => null));
		const body: Envelope = parsed.success ? parsed.output : {};

		if (response.status === 429) {
			// Bot API tells us how long to wait; the queue's backoff owns that wait, this client never sleeps.
			throw new TelegramError(this.#safe(body.description ?? `${method} rate limited`), {
				status: 429,
				retryAfterSec: body.parameters?.retry_after
			});
		}

		if (!response.ok || body.ok !== true) {
			// `description` is Bot API prose ("chat not found"), worth surfacing as-is.
			throw new TelegramError(
				this.#safe(body.description ?? `${method} failed with ${response.status}`),
				{ status: body.error_code ?? response.status }
			);
		}

		const result = v.safeParse(schema, body.result);
		if (!result.success) {
			throw new TelegramError(`${method} returned a result with an unexpected shape`, {
				status: response.status
			});
		}

		return result.output;
	}

	/**
	 * Defence in depth. Nothing upstream is supposed to echo the token back, but the guarantee
	 * "the token never reaches an error or a log" must not rest on the upstream's good manners.
	 */
	#safe(message: string): string {
		// Guard the empty token: ''.split('') shreds the string into characters and the scrub would
		// corrupt every message it was meant to protect.
		if (this.#botToken.length === 0) return message;
		return message.split(this.#botToken).join('<bot_token>');
	}
}
