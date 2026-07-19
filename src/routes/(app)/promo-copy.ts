import type { PromoError } from '$lib/types';

/**
 * What each refusal from the promo domain says to a person, once.
 *
 * Two screens ask about a promo code — the check on Профиль and the purchase on Главная — and both
 * get the same five answers back. Written here rather than in either route so the two cannot drift
 * into telling somebody different things about the same code (CLAUDE.md 4).
 *
 * It lives in the route tree because it is interface copy: `$lib/server` is unreachable from a
 * component, and the frozen folder layout (tech.md 4) offers no shared non-server module a developer
 * may add to — the same reason `plan-value.ts` sits next door.
 *
 * Each sentence says what happened and what to do about it (tech.md 11), and none of them explains
 * how the shop works internally: "уже применён" covers both a code spent months ago and one claimed
 * by an order still on the payment page, because from the outside those are the same fact.
 */
export const PROMO_MESSAGES: Record<PromoError, string> = {
	not_found: 'Такого промокода нет. Проверьте, как он написан.',
	inactive: 'Этот промокод сейчас не действует.',
	expired: 'Срок действия промокода истёк.',
	exhausted: 'Промокод уже разобрали.',
	already_used: 'Этот промокод вы уже применили.'
};

/**
 * What a spent attempt budget says. One limiter counts both screens (CLAUDE.md 2 — five attempts per
 * ten minutes per person), so they have to say the same thing: two sentences for one budget would
 * read as two different limits to whoever hit it on one screen and then tried the other.
 */
export const promoRateLimitMessage = (retryAfterSec: number): string =>
	`Слишком много попыток с промокодом. Попробуйте через ${Math.ceil(retryAfterSec / 60)} мин.`;
