import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { sessions, telegramAuth } from '$lib/server/container';
import { AppError, RateLimitError, ValidationError, toHttp } from '$lib/server/errors';
import { log } from '$lib/server/log';
import type { RequestHandler } from './$types';

/**
 * Swaps Telegram's initData for our session cookie (tech.md 9). One of the three public paths: it
 * arrives without a session by definition and authenticates itself with the HMAC instead.
 *
 * The mini app posts here on start, then calls invalidateAll() so SSR re-renders signed in.
 */

/**
 * The whole request surface. A ceiling on the string keeps a stranger from ordering an HMAC over
 * a megabyte before the signature has proved anything; real initData is a few hundred bytes.
 */
const BodySchema = v.object({
	initData: v.pipe(v.string(), v.minLength(1, 'initData is required'), v.maxLength(4096))
});

/** Never fatal: an adapter that cannot name the peer must not take the login down with it. */
function clientIp(getClientAddress: () => string): string {
	try {
		return getClientAddress();
	} catch {
		// One shared bucket is the safe direction — still limited, just less precisely.
		return 'unknown';
	}
}

export const POST: RequestHandler = async ({ request, cookies, locals, getClientAddress }) => {
	const requestLog = log.child({ requestId: locals.requestId });

	try {
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			throw new ValidationError('Ожидали JSON с полем initData.');
		}

		const { initData } = v.parse(BodySchema, body);
		const user = telegramAuth.exchange(initData, clientIp(getClientAddress));

		sessions.issue(cookies, user.id);

		// Ids only. The initData string itself never reaches a log line (CLAUDE.md 2).
		requestLog.info('auth_session_issued', { userId: user.id, telegramId: user.telegramId });

		return json({ ok: true });
	} catch (err) {
		/**
		 * A schema failure is the caller's problem; anything else — SQLite gone, a bug — is ours and
		 * must stay a 500. Folding every unknown throw into ValidationError would answer 400 to a
		 * dead database and hide the outage behind "check your input".
		 */
		const known =
			err instanceof AppError
				? err
				: v.isValiError(err)
					? new ValidationError('Ожидали JSON с полем initData.', { cause: err })
					: null;

		const { status, body } = toHttp(known ?? err, locals.requestId);

		if (known) {
			requestLog.warn('auth_exchange_failed', { code: known.code, status, error: known });
		} else {
			requestLog.error('auth_exchange_failed', { status, error: err });
		}

		const headers =
			known instanceof RateLimitError ? { 'retry-after': String(known.retryAfterSec) } : undefined;

		return json(body, { status, headers });
	}
};
