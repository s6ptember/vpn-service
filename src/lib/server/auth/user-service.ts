import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users, type UserRow } from '../db/schema';
import type { TelegramProfile } from './init-data';

export interface UserServiceOptions {
	now?: () => number;
}

/**
 * The users table, owned by one class (tech.md 9, step 4). Deps by constructor, no HTTP and no
 * cookie knowledge: the route decides what to do with the row, this decides what the row is.
 */
export class UserService {
	private readonly now: () => number;

	constructor(
		private readonly db: Db,
		opts: UserServiceOptions = {}
	) {
		this.now = opts.now ?? Date.now;
	}

	/**
	 * Creates the account on first sight and refreshes the profile on every login after that:
	 * people rename themselves, change their @username and replace their avatar, and the copy we
	 * show has to follow. telegramId is the natural key, so a second login can never fork a row.
	 */
	upsertFromTelegram(profile: TelegramProfile): UserRow {
		const timestamp = new Date(this.now());

		return this.db
			.insert(users)
			.values({
				telegramId: profile.telegramId,
				username: profile.username,
				firstName: profile.firstName,
				lastName: profile.lastName,
				photoUrl: profile.photoUrl,
				languageCode: profile.languageCode,
				createdAt: timestamp,
				updatedAt: timestamp
			})
			.onConflictDoUpdate({
				target: users.telegramId,
				set: {
					username: profile.username,
					firstName: profile.firstName,
					lastName: profile.lastName,
					photoUrl: profile.photoUrl,
					languageCode: profile.languageCode,
					updatedAt: timestamp
				}
				// createdAt, isBlocked and stripeCustomerId are deliberately absent: signing in again
				// must not reset when somebody joined, unblock them, or orphan a Stripe customer.
			})
			.returning()
			.get();
	}

	/**
	 * The full row, for the server side that needs more than SessionUser carries — the checkout
	 * needs `stripeCustomerId`, the provision job needs `telegramId` to name the Marzban user and to
	 * address the message. Rows stay inside lib/server; a load hands out DTOs (CLAUDE.md 1.4).
	 */
	findById(id: number): UserRow | null {
		return this.db.select().from(users).where(eq(users.id, id)).get() ?? null;
	}

	/**
	 * By the Telegram account, which is the natural key (tech.md 5) and the only id an admin ever
	 * sees: it is what the relayed support message prints when somebody has no @username, and the
	 * reconcile form in the panel takes it (A16).
	 */
	findByTelegramId(telegramId: number): UserRow | null {
		return this.db.select().from(users).where(eq(users.telegramId, telegramId)).get() ?? null;
	}
}
