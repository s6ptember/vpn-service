import { createHmac, timingSafeEqual } from 'node:crypto';
import * as v from 'valibot';
import { AuthError, ValidationError } from '../errors';

/**
 * Telegram initData validation (tech.md 9). One dependency: the bot token.
 *
 * The whole class works on the RAW query string it was handed. Rebuilding the check string from
 * `initDataUnsafe` is the classic way to lose an afternoon: JSON escaping inside `user`
 * (`https:\/\/t.me\/…` in photo_url) does not survive a parse/serialise round trip, and the hash
 * stops matching for no visible reason.
 */

/** The Telegram profile as it arrives, already mapped to our column names. */
export interface TelegramProfile {
	telegramId: number;
	firstName: string;
	lastName: string | null;
	username: string | null;
	photoUrl: string | null;
	languageCode: string | null;
}

export interface ValidatedInitData {
	profile: TelegramProfile;
	authDateSec: number;
	/** `startapp=…` payload, the deep link A7 reads to spot a returning payer. Null when absent. */
	startParam: string | null;
}

export interface InitDataValidatorOptions {
	botToken: string;
	maxAgeSec: number;
	now?: () => number;
}

/**
 * `user` is signed, so it cannot be forged — but it can still be shaped unexpectedly by a client
 * we do not control, and it lands in a NOT NULL column. Unknown members (is_premium,
 * allows_write_to_pm) are dropped by valibot rather than rejected: Telegram adds fields over time.
 */
const ProfileSchema = v.object({
	id: v.pipe(v.number(), v.integer(), v.minValue(1)),
	first_name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(256)),
	last_name: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(256))),
	username: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(64))),
	/**
	 * Cosmetic and rendered into an <img src>, so it is checked for an https URL — and on failure
	 * falls back to "no photo" instead of failing the login. Locking somebody out of the app over
	 * an avatar would be the wrong trade.
	 */
	photo_url: v.fallback(
		v.optional(
			v.pipe(
				v.string(),
				v.url(),
				v.check((value) => value.startsWith('https://'), 'photo_url must be https')
			)
		),
		undefined
	),
	language_code: v.fallback(v.optional(v.pipe(v.string(), v.trim(), v.maxLength(16))), undefined)
});

/** Optional text fields are stored as NULL, never as '' — one absent value, one representation. */
const orNull = (value: string | undefined): string | null => (value ? value : null);

export class InitDataValidator {
	private readonly now: () => number;

	constructor(private readonly opts: InitDataValidatorOptions) {
		this.now = opts.now ?? Date.now;
	}

	/**
	 * Throws AuthError('bad_signature') when the HMAC does not hold, AuthError('expired_init_data')
	 * when the payload is older than INIT_DATA_MAX_AGE_SEC, ValidationError when Telegram signed
	 * something we cannot read. Returns only on all three counts passing.
	 */
	validate(rawInitData: string): ValidatedInitData {
		const params = new URLSearchParams(rawInitData);

		const hash = params.get('hash');
		if (!hash) throw new AuthError('bad_signature');

		// Only `hash` leaves the check string. `signature` (Ed25519, for third-party verification)
		// stays: dropping it silently breaks every login from a client that sends it.
		params.delete('hash');

		this.assertSignature(params, hash);

		const authDateSec = this.readAuthDate(params);
		const profile = this.readProfile(params);

		return { profile, authDateSec, startParam: params.get('start_param') };
	}

	private assertSignature(params: URLSearchParams, hash: string): void {
		const dataCheckString = [...params.entries()]
			// Code-unit order, which is what Telegram's algorithm means by "sorted alphabetically".
			// localeCompare answers to ICU collation instead, and a locale that treats '_' or case
			// differently would reorder the lines and break every signature on that host only.
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, value]) => `${key}=${value}`)
			.join('\n');

		const secretKey = createHmac('sha256', 'WebAppData').update(this.opts.botToken).digest();
		const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

		const a = Buffer.from(expected);
		const b = Buffer.from(hash);
		// Length is compared first because timingSafeEqual throws on a mismatch, and a throw here
		// would leak the same fact as a fast `false` while also skipping the AuthError path.
		if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AuthError('bad_signature');
	}

	private readAuthDate(params: URLSearchParams): number {
		const raw = params.get('auth_date');
		const authDateSec = Number(raw);
		if (!raw || !Number.isInteger(authDateSec) || authDateSec <= 0) {
			throw new ValidationError('Telegram прислал вход в неизвестном формате.');
		}

		// Only the past is checked. A timestamp from the future cannot be minted without the bot
		// token, so an early clock on the Telegram side must not lock anybody out.
		const ageSec = Math.floor(this.now() / 1000) - authDateSec;
		if (ageSec > this.opts.maxAgeSec) throw new AuthError('expired_init_data');

		return authDateSec;
	}

	private readProfile(params: URLSearchParams): TelegramProfile {
		const raw = params.get('user');
		if (!raw) throw new ValidationError('Telegram не передал профиль. Откройте приложение заново.');

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw new ValidationError('Telegram прислал профиль в неизвестном формате.');
		}

		const result = v.safeParse(ProfileSchema, parsed);
		if (!result.success) {
			throw new ValidationError('Telegram прислал профиль в неизвестном формате.');
		}

		const user = result.output;
		return {
			telegramId: user.id,
			firstName: user.first_name,
			lastName: orNull(user.last_name),
			username: orNull(user.username),
			photoUrl: orNull(user.photo_url),
			languageCode: orNull(user.language_code)
		};
	}
}
