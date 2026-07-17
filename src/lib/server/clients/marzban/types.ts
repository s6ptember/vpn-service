import * as v from 'valibot';

/**
 * Marzban is the single source of truth for VPN access (tech.md 1). The app never touches its DB,
 * only this REST contract, copied from tech.md 8. Swapping the panel costs one implementation.
 */
export interface MarzbanApi {
	createUser(input: MarzbanUserInput): Promise<MarzbanUser>;
	getUser(username: string): Promise<MarzbanUser | null>;
	setExpiry(username: string, expiresAtMs: number): Promise<MarzbanUser>;
	setStatus(username: string, status: 'active' | 'disabled'): Promise<void>;
	deleteUser(username: string): Promise<void>;
}

export interface MarzbanUserInput {
	username: string; // tg_<telegramId>, 3..32 символа
	expiresAtMs: number; // ms; клиент сам переведёт в секунды
	dataLimitBytes: number; // 0 = безлимит
	note?: string;
}

export interface MarzbanUser {
	username: string;
	status: 'active' | 'disabled' | 'limited' | 'expired' | 'on_hold';
	expiresAtMs: number;
	usedTrafficBytes: number;
	subscriptionUrl: string; // абсолютный, зависит от XRAY_SUBSCRIPTION_URL_PREFIX
	links: string[];
}

/** Statuses Marzban can report back. Only 'active' and 'disabled' are ours to set. */
export const MARZBAN_USER_STATUSES = [
	'active',
	'disabled',
	'limited',
	'expired',
	'on_hold'
] as const;

/**
 * One Marzban user per person, named tg_<telegramId> (tech.md 17.4). The shape is pinned here so
 * the fake can reject a malformed username instead of letting the real panel do it in production.
 */
export const MARZBAN_USERNAME_PATTERN = /^tg_\d+$/;

/**
 * The contract as a runtime check. FakeMarzban parses every input through it: the fake is the test
 * seam (tech.md 8), so a slice that sends garbage must fail loudly in a unit test, not at 3am.
 */
export const MarzbanUserInputSchema: v.GenericSchema<unknown, MarzbanUserInput> = v.object({
	username: v.pipe(
		v.string(),
		v.minLength(3, 'username must be at least 3 characters'),
		v.maxLength(32, 'username must be at most 32 characters'),
		v.regex(MARZBAN_USERNAME_PATTERN, 'username must look like tg_<telegramId>')
	),
	// Marzban stores `expire` in seconds; we hand it milliseconds and convert in http.ts only.
	expiresAtMs: v.pipe(
		v.number(),
		v.integer('expiresAtMs must be an integer'),
		v.minValue(1, 'expiresAtMs must be a positive epoch in ms')
	),
	dataLimitBytes: v.pipe(
		v.number(),
		v.integer('dataLimitBytes must be an integer'),
		v.minValue(0, 'dataLimitBytes must be 0 (unlimited) or more')
	),
	note: v.optional(v.string())
});
