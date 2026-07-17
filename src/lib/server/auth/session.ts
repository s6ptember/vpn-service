import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Cookies } from '@sveltejs/kit';
import type { SessionUser } from '$lib/types';
import type { Db } from '../db/client';
import { users, type UserRow } from '../db/schema';

export const SESSION_COOKIE = 'session';

export interface SessionOptions {
	secret: string;
	ttlDays: number;
	adminChatId: number;
	now?: () => number;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/**
 * Signed stateless session cookie: `<base64url({uid,exp})>.<hmac>`. No session table — the token
 * carries its own expiry and the HMAC makes it unforgeable, so a read costs one users lookup.
 */
export class SessionService {
	private readonly now: () => number;

	constructor(
		private readonly db: Db,
		private readonly opts: SessionOptions
	) {
		this.now = opts.now ?? Date.now;
	}

	private sign(payload: string): string {
		return createHmac('sha256', this.opts.secret).update(payload).digest('base64url');
	}

	private token(userId: number, expMs: number): string {
		const payload = b64url(Buffer.from(JSON.stringify({ uid: userId, exp: expMs })));
		return `${payload}.${this.sign(payload)}`;
	}

	/** Returns the user id only if the signature holds and the token has not expired. */
	private verify(token: string): number | null {
		const dot = token.lastIndexOf('.');
		if (dot <= 0) return null;

		const payload = token.slice(0, dot);
		const signature = token.slice(dot + 1);
		const expected = this.sign(payload);

		// Constant-time compare; length must match first or timingSafeEqual throws.
		const a = Buffer.from(signature);
		const b = Buffer.from(expected);
		if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

		try {
			const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
				uid?: unknown;
				exp?: unknown;
			};
			if (typeof claims.uid !== 'number' || typeof claims.exp !== 'number') return null;
			if (claims.exp <= this.now()) return null;
			return claims.uid;
		} catch {
			return null;
		}
	}

	private toSessionUser(row: UserRow): SessionUser {
		return {
			id: row.id,
			telegramId: row.telegramId,
			username: row.username,
			firstName: row.firstName,
			lastName: row.lastName,
			photoUrl: row.photoUrl,
			// Derived, never stored: keeps "admin lives in .env" true instead of a copy that drifts.
			isAdmin: row.telegramId === this.opts.adminChatId
		};
	}

	read(cookies: Cookies): SessionUser | null {
		const token = cookies.get(SESSION_COOKIE);
		if (!token) return null;

		const userId = this.verify(token);
		if (userId === null) return null;

		const row = this.db.select().from(users).where(eq(users.id, userId)).get();
		if (!row) return null;

		// A blocked user keeps a valid cookie; treat them as signed out rather than trusting it.
		if (row.isBlocked) return null;

		return this.toSessionUser(row);
	}

	issue(cookies: Cookies, userId: number): void {
		const maxAgeSec = this.opts.ttlDays * 24 * 60 * 60;
		cookies.set(SESSION_COOKIE, this.token(userId, this.now() + maxAgeSec * 1000), {
			path: '/',
			httpOnly: true,
			secure: true,
			// The mini app runs in a Telegram iframe on Desktop and Web; 'lax' would drop the cookie.
			// 'none' forces secure, and SvelteKit's Origin-based CSRF check stays on to compensate.
			sameSite: 'none',
			maxAge: maxAgeSec
		});
	}

	clear(cookies: Cookies): void {
		cookies.delete(SESSION_COOKIE, { path: '/', httpOnly: true, secure: true, sameSite: 'none' });
	}
}
