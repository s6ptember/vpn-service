import { AppError, AuthError, RateLimitError } from '../errors';
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
		/**
		 * Refused attempts are what the budget pays for (CLAUDE.md 2: 10/min per IP). A login that
		 * proves it holds our HMAC is not abuse, and charging it would turn the limiter into an
		 * outage the moment several people share one source address — which is the normal case
		 * behind a reverse proxy, on carrier NAT, or in an office.
		 */
		const budget = this.limiter.peek(clientIp);
		if (!budget.allowed) throw new RateLimitError(budget.retryAfterSec);

		let user: UserRow;
		try {
			const { profile } = this.validator.validate(rawInitData);
			user = this.users.upsertFromTelegram(profile);
		} catch (err) {
			// A dead database is our failure, not the caller's, and must not spend their budget.
			if (err instanceof AppError) this.limiter.consume(clientIp);
			throw err;
		}

		// The upsert still runs for a blocked account — their name and photo stay current for the
		// admin screens — but no cookie is issued, so nothing downstream sees them as signed in.
		if (user.isBlocked) {
			this.limiter.consume(clientIp);
			throw new AuthError('blocked', 'Доступ к приложению закрыт. Напишите в поддержку.');
		}

		return user;
	}
}
