import * as v from 'valibot';
import { MarzbanError, ValidationError } from '$lib/server/errors';
import { MarzbanUserInputSchema, type MarzbanApi, type MarzbanUser } from './types';

/** The fake serves this prefix, so a subscription URL is absolute here exactly as in production. */
export const FAKE_SUB_ORIGIN = 'https://sub.local';

export type MarzbanFailMode = 'timeout' | 500;

/**
 * In-memory Marzban. A developer writes a slice against this without a panel, an access or a token
 * (tech.md 8), and it is the test seam: it validates every input against the contract schema and
 * dies loudly when a slice sends garbage, instead of letting the real panel discover it later.
 *
 * It starts empty on purpose, which is what scripts/seed.ts describes: the seed creates plans,
 * promo codes, FAQ and two users, and no subscriptions — so nobody has a Marzban user yet. A test
 * that needs one calls seed().
 */
export class FakeMarzban implements MarzbanApi {
	/** Instance field: two tests must never share a user map (CLAUDE.md 1.2). */
	readonly #users = new Map<string, MarzbanUser>();
	#failNext: MarzbanFailMode | null = null;

	async createUser(input: unknown): Promise<MarzbanUser> {
		const parsed = this.#validate(input);
		this.#failIfArmed();

		// The real panel answers 409 on a duplicate username; a slice must handle that, not be
		// surprised by it in production.
		if (this.#users.has(parsed.username)) {
			throw new MarzbanError(`user ${parsed.username} already exists`, { status: 409 });
		}

		const user: MarzbanUser = {
			username: parsed.username,
			status: 'active',
			expiresAtMs: parsed.expiresAtMs,
			usedTrafficBytes: 0,
			subscriptionUrl: `${FAKE_SUB_ORIGIN}/sub/${parsed.username}`,
			links: [`vless://${parsed.username}@vpn.local:443?type=tcp&security=reality#VLESS`]
		};
		this.#users.set(user.username, user);
		return { ...user };
	}

	async getUser(username: string): Promise<MarzbanUser | null> {
		this.#failIfArmed();
		const user = this.#users.get(username);
		return user ? { ...user } : null;
	}

	async setExpiry(username: string, expiresAtMs: number): Promise<MarzbanUser> {
		this.#failIfArmed();
		if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < 1) {
			throw new ValidationError(`expiresAtMs must be a positive epoch in ms, got ${expiresAtMs}`);
		}

		const user = this.#require(username);
		const updated: MarzbanUser = { ...user, expiresAtMs };
		this.#users.set(username, updated);
		return { ...updated };
	}

	async setStatus(username: string, status: 'active' | 'disabled'): Promise<void> {
		this.#failIfArmed();
		const user = this.#require(username);
		this.#users.set(username, { ...user, status });
	}

	async deleteUser(username: string): Promise<void> {
		this.#failIfArmed();
		// Mirrors MarzbanHttp: already gone is the state we wanted, so a retried job converges.
		this.#users.delete(username);
	}

	/**
	 * Arms the next call to fail once, then disarm. Error-path tests (tech.md 14) ride this rather
	 * than a mock, so they exercise the same MarzbanError the real client throws.
	 */
	failNext(mode: MarzbanFailMode): void {
		this.#failNext = mode;
	}

	/** Loads users directly, bypassing createUser. For arranging a test's starting state. */
	seed(users: MarzbanUser[]): void {
		for (const user of users) this.#users.set(user.username, { ...user });
	}

	reset(): void {
		this.#users.clear();
		this.#failNext = null;
	}

	#validate(input: unknown): v.InferOutput<typeof MarzbanUserInputSchema> {
		const parsed = v.safeParse(MarzbanUserInputSchema, input);
		if (!parsed.success) {
			const reasons = parsed.issues.map((issue) => issue.message).join('; ');
			throw new ValidationError(`FakeMarzban rejected createUser input: ${reasons}`);
		}
		return parsed.output;
	}

	#require(username: string): MarzbanUser {
		const user = this.#users.get(username);
		if (!user) throw new MarzbanError(`user ${username} not found`, { status: 404 });
		return user;
	}

	#failIfArmed(): void {
		const mode = this.#failNext;
		this.#failNext = null;
		if (mode === null) return;

		if (mode === 'timeout') {
			// Shape of a real timeout: the client retried, gave up, and has no HTTP status to report.
			throw new MarzbanError('marzban request timed out after 10000ms', {});
		}
		throw new MarzbanError('marzban answered 500', { status: 500 });
	}
}
