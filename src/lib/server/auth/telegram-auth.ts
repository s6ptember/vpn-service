import { AuthError, RateLimitError } from '../errors';
import type { RateLimiter } from '../rate-limit';
import type { UserRow } from '../db/schema';
import type { InitDataValidator } from './init-data';
import type { UserService } from './user-service';

/**
 * The initData → account exchange, one class, deps by constructor (tech.md 9, steps 3–4).
 *
 * It stops one step short of the cookie on purpose: issuing it needs the response, which is the
 * route's business. This layer answers only "who is this, and are they allowed in" — which is why
 * it is testable without a RequestEvent.
 */
export class TelegramAuthService {
	constructor(
		private readonly validator: InitDataValidator,
		private readonly users: UserService,
		private readonly limiter: RateLimiter
	) {}

	/**
	 * Throws RateLimitError, AuthError('bad_signature' | 'expired_init_data' | 'blocked') or
	 * ValidationError. Returns the row the session cookie should be issued for.
	 */
	exchange(rawInitData: string, clientIp: string): UserRow {
		// Counted before the HMAC: the point of the limit is to cap the work a stranger can order,
		// and the signature check is the expensive part of it (tech.md 2, 10/min per IP).
		const decision = this.limiter.check(clientIp);
		if (!decision.allowed) throw new RateLimitError(decision.retryAfterSec);

		const { profile } = this.validator.validate(rawInitData);
		const user = this.users.upsertFromTelegram(profile);

		// The upsert still runs for a blocked account — their name and photo stay current for the
		// admin screens — but no cookie is issued, so nothing downstream sees them as signed in.
		if (user.isBlocked) {
			throw new AuthError('blocked', 'Доступ к приложению закрыт. Напишите в поддержку.');
		}

		return user;
	}
}
