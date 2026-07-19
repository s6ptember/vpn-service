import { fail } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { access, promoCheckInput, promoLimiter, promos } from '$lib/server/container';
import { log } from '$lib/server/log';
import type { PromoCodeDTO } from '$lib/types';
import { PROMO_MESSAGES } from '../promo-copy';
import type { Actions, PageServerLoad } from './$types';

/**
 * A9 — the active plan, the end date, the link and the QR.
 * A10 — the promo check. A12 — the purchase history.
 *
 * `subscriptionUrl` is the key itself: whoever holds it holds the VPN. tech.md 7 says it goes to
 * the owner and nobody else, and the only thing standing behind that promise is this line — the
 * subscription is read for `locals.user`, never for an id off the URL or the form.
 */
export const load: PageServerLoad = async ({ locals, depends }) => {
	// A7 polls this key while it waits for a payment to turn into a key (see (app)/+page.server.ts).
	depends('app:subscription');

	/**
	 * The shell renders before the cookie lands (tech.md 9), so a load with no user is normal and
	 * answers empty. invalidateAll() after the exchange runs it again with the person in place.
	 */
	// One currency for the whole base (tech.md 5). The promo block shows it; it never submits it.
	const currency = config.PRICE_CURRENCY;

	if (!locals.user) {
		return { subscription: null, latestOrder: null, awaitingKey: false, history: [], currency };
	}

	return {
		...access.forUser(locals.user.id),
		history: access.historyFor(locals.user.id),
		currency
	};
};

/** What the promo block gets back. A refusal carries the sentence; a hit carries the code itself. */
interface PromoCheckResult {
	ok: boolean;
	message: string | null;
	/** The code as the domain knows it, so the block can name what it is worth. */
	promo: PromoCodeDTO | null;
	/** What was typed, so a no-JS reload comes back filled instead of blank. */
	code: string;
}

const refuse = (status: number, message: string, code: string) =>
	fail(status, { ok: false, message, promo: null, code } satisfies PromoCheckResult);

export const actions = {
	/**
	 * A10 — tells somebody whether a code works before they go and buy something with it. It writes
	 * nothing: the code is spent by the provision job once the money lands (tech.md 6), and applying
	 * it to a purchase happens on Главная, where tech.md 10 step 1 puts it.
	 */
	checkPromo: async ({ request, locals }) => {
		/**
		 * The guard in hooks.server.ts already 401s a POST without a session. This is the second check
		 * tech.md 9 asks for rather than a copy of the first: "has this person used this code" is a
		 * question about somebody, and that somebody comes off the session and never off the form.
		 */
		if (!locals.user) {
			return refuse(401, 'Откройте приложение из Telegram, чтобы проверить промокод.', '');
		}

		const values = Object.fromEntries(await request.formData());
		// Echoed back exactly as typed. The domain sees the parsed, upper-cased version instead.
		const typed = typeof values.promoCode === 'string' ? values.promoCode : '';

		const parsed = promoCheckInput.parse(values);
		if (!parsed.ok) return refuse(400, parsed.error, typed);

		/**
		 * CLAUDE.md 2: five attempts per ten minutes per person. Peeked before the lookup rather than
		 * spent on it — a code that turns out to work is not an attempt at anything, and only refusals
		 * teach a guesser whether a code exists.
		 */
		const budget = promoLimiter.peek(String(locals.user.id));
		if (!budget.allowed) {
			return refuse(
				429,
				`Слишком много попыток. Попробуйте через ${Math.ceil(budget.retryAfterSec / 60)} мин.`,
				typed
			);
		}

		const resolved = promos.resolve(parsed.value, locals.user.id);

		if (!resolved.ok) {
			promoLimiter.consume(String(locals.user.id));
			// The reason, never the code: a working promo code is a bearer secret, and redact() masks
			// by key name rather than by value (CLAUDE.md 2).
			log.info('promo_check_refused', { requestId: locals.requestId, reason: resolved.error });

			return refuse(400, PROMO_MESSAGES[resolved.error], typed);
		}

		return {
			ok: true,
			// The block says what the code is worth itself, with Money.svelte where that takes money.
			message: null,
			promo: resolved.value,
			code: resolved.value.code
		} satisfies PromoCheckResult;
	}
} satisfies Actions;
