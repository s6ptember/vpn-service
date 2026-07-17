/**
 * Error hierarchy for the server side (CLAUDE.md 3).
 *
 * The domain throws AppError and knows nothing about HTTP. The single `code` -> status mapping is
 * toHttp() at the bottom of this file, called at the route boundary. Expected domain outcomes
 * (promo expired, limit spent) are Result from $lib/types — errors never steer normal flow.
 */

/** Why an authentication attempt failed. Reported as `auth_<reason>`. */
export type AuthReason = 'bad_signature' | 'expired_init_data' | 'no_session' | 'blocked';

/** Every code the server can produce. toHttp() maps this union exhaustively, so adding a code
 *  without deciding its status is a type error rather than a surprise 500 in production. */
export type ErrorCode =
	| `auth_${AuthReason}`
	| 'forbidden'
	| 'not_found'
	| 'validation'
	| 'conflict'
	| 'rate_limit'
	| 'marzban_error'
	| 'telegram_error'
	| 'payment_bad_signature'
	| 'payment_error'
	| 'config_error';

export interface ErrorOptions {
	cause?: unknown;
}

export abstract class AppError extends Error {
	abstract readonly code: ErrorCode;

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		// Downlevelling a builtin subclass drops the prototype chain, which silently breaks
		// `instanceof` and would send every domain error down the unknown path in toHttp().
		Object.setPrototypeOf(this, new.target.prototype);
		this.name = new.target.name;
	}
}

/** Session or initData could not be trusted. Carries no initData: that string is a secret. */
export class AuthError extends AppError {
	readonly code: ErrorCode;
	readonly reason: AuthReason;

	constructor(
		reason: AuthReason,
		message = 'Не удалось подтвердить вход. Откройте приложение из Telegram заново.',
		options?: ErrorOptions
	) {
		super(message, options);
		this.reason = reason;
		this.code = `auth_${reason}`;
	}
}

/** Authenticated, but not allowed here — an admin path without ADMIN_CHAT_ID. */
export class ForbiddenError extends AppError {
	readonly code = 'forbidden' as const;

	constructor(message = 'Доступ закрыт.', options?: ErrorOptions) {
		super(message, options);
	}
}

export class NotFoundError extends AppError {
	readonly code = 'not_found' as const;

	constructor(message = 'Не нашли то, что вы искали.', options?: ErrorOptions) {
		super(message, options);
	}
}

/** Input failed its valibot schema. Field-level form issues go back through fail(400), not here. */
export class ValidationError extends AppError {
	readonly code = 'validation' as const;

	constructor(message = 'Проверьте введённые данные.', options?: ErrorOptions) {
		super(message, options);
	}
}

/** A unique constraint or a state machine rejected the write. */
export class ConflictError extends AppError {
	readonly code = 'conflict' as const;

	constructor(message = 'Это действие уже выполнено.', options?: ErrorOptions) {
		super(message, options);
	}
}

export class RateLimitError extends AppError {
	readonly code = 'rate_limit' as const;
	/** Seconds until the caller may try again. The route turns it into a Retry-After header. */
	readonly retryAfterSec: number;

	constructor(
		retryAfterSec: number,
		message = 'Слишком много попыток. Подождите немного и повторите.',
		options?: ErrorOptions
	) {
		super(message, options);
		this.retryAfterSec = retryAfterSec;
	}
}

/** Marzban refused a call. `status` is null when no HTTP answer arrived: timeout or network. */
export class MarzbanError extends AppError {
	readonly code = 'marzban_error' as const;
	readonly status: number | null;

	constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
		super(message, { cause: options.cause });
		this.status = options.status ?? null;
	}
}

/** Bot API refused a call. Never carries the bot token: the token is a secret, the log is not. */
export class TelegramError extends AppError {
	readonly code = 'telegram_error' as const;
	readonly status: number | null;
	/** Present on 429 only. The job queue owns the wait — the client itself never sleeps. */
	readonly retryAfterSec: number | null;

	constructor(
		message: string,
		options: { status?: number; retryAfterSec?: number; cause?: unknown } = {}
	) {
		super(message, { cause: options.cause });
		this.status = options.status ?? null;
		this.retryAfterSec = options.retryAfterSec ?? null;
	}
}

/**
 * Webhook signature did not verify. This is the webhook's only authentication,
 * so the route answers 400 without touching the database.
 */
export class PaymentSignatureError extends AppError {
	readonly code = 'payment_bad_signature' as const;
}

/** Payment provider misbehaved: unreachable, or a signed payload we cannot act on. */
export class PaymentProviderError extends AppError {
	readonly code = 'payment_error' as const;
}

/** A wiring mistake: missing option, impossible combination. Never the caller's fault. */
export class ConfigError extends AppError {
	readonly code = 'config_error' as const;
}

const GENERIC_MESSAGE = 'Что-то пошло не так. Попробуйте ещё раз.';
const UPSTREAM_MESSAGE = 'Сервис временно недоступен. Попробуйте ещё раз через минуту.';

interface HttpRule {
	status: number;
	/**
	 * Replaces err.message on the way out. Set it for codes whose message is written for us, not
	 * for the person: upstream prose carries hostnames, panel paths and provider internals.
	 */
	message?: string;
}

const RULES: Record<ErrorCode, HttpRule> = {
	auth_bad_signature: { status: 401 },
	auth_expired_init_data: { status: 401 },
	auth_no_session: { status: 401 },
	auth_blocked: { status: 403 },
	forbidden: { status: 403 },
	not_found: { status: 404 },
	validation: { status: 400 },
	conflict: { status: 409 },
	rate_limit: { status: 429 },
	marzban_error: { status: 502, message: UPSTREAM_MESSAGE },
	telegram_error: { status: 502, message: UPSTREAM_MESSAGE },
	payment_bad_signature: { status: 400, message: 'Подпись платежа не сошлась.' },
	payment_error: {
		status: 502,
		message: 'Оплата временно недоступна. Попробуйте ещё раз через минуту.'
	},
	config_error: { status: 500, message: GENERIC_MESSAGE }
};

/**
 * The one code -> HTTP mapping, used at the route boundary. It returns the shape instead of
 * throwing kit's error(): handleError in hooks must not set a status, and a +server.ts webhook
 * wants a Response rather than a thrown redirect-shaped object.
 */
export function toHttp(err: unknown, requestId: string): { status: number; body: App.Error } {
	if (err instanceof AppError) {
		const rule = RULES[err.code];
		return {
			status: rule.status,
			body: { code: err.code, message: rule.message ?? err.message, requestId }
		};
	}

	// Anything else is a bug or a dependency blowing up: its message can hold a DSN, a query or a
	// token, so it stays in the log and the caller gets only the requestId to quote at us.
	return { status: 500, body: { code: 'internal', message: GENERIC_MESSAGE, requestId } };
}
