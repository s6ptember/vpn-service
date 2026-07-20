import { fail } from '@sveltejs/kit';
import type { CheckoutError } from '$lib/server/billing';
import { access, checkout, checkoutInput, plans, promoLimiter, users } from '$lib/server/container';
import { AppError, toHttp } from '$lib/server/errors';
import { log } from '$lib/server/log';
import { PROMO_MESSAGES, promoRateLimitMessage } from './promo-copy';
import type { Actions, PageServerLoad } from './$types';

/**
 * Reference slice: load returns DTOs from the domain, never DB rows (CLAUDE.md 1.4).
 *
 * Plans are public, so this survives locals.user === null and renders the same list to a signed-out
 * shell (tech.md 9). Exactly one render lives in that state before the cookie lands.
 */
export const load: PageServerLoad = async ({ locals, depends }) => {
	/**
	 * The dependency A7 polls on. The client calls invalidate('app:subscription') every few seconds
	 * while it waits for a payment to land, and this is what makes that call re-run this load
	 * rather than do nothing at all.
	 */
	depends('app:subscription');

	const view = locals.user
		? access.forUser(locals.user.id)
		: {
				subscription: null,
				plan: null,
				trafficUsedBytes: Promise.resolve(null),
				latestOrder: null,
				awaitingKey: false
			};

	return { plans: plans.listActive(), ...view };
};

/** What the page gets back from a refused checkout. A success carries the link instead. */
interface CheckoutFailure {
	message: string;
}

/**
 * Every refusal the domain can hand back, and what each one is worth in HTTP and in Russian.
 *
 * Exhaustive by type: `CheckoutError` gains an arm and this table stops compiling, so a new way to
 * refuse a purchase cannot ship as a generic sentence nobody can act on. The promo lines come from
 * the shared copy, because Профиль answers the same five refusals about the same five codes.
 */
const CHECKOUT_RULES: Record<CheckoutError, { status: number; message: string }> = {
	// A stale card: the plan was hidden or archived while this page sat open.
	plan_unavailable: { status: 409, message: 'Этот тариф больше не продаётся. Выберите другой.' },
	promo_not_found: { status: 400, message: PROMO_MESSAGES.not_found },
	promo_inactive: { status: 400, message: PROMO_MESSAGES.inactive },
	promo_expired: { status: 400, message: PROMO_MESSAGES.expired },
	promo_exhausted: { status: 400, message: PROMO_MESSAGES.exhausted },
	promo_already_used: { status: 400, message: PROMO_MESSAGES.already_used }
};

const isPromoRefusal = (error: CheckoutError) => error.startsWith('promo_');

/**
 * Which refusals count against the attempt budget.
 *
 * Everything a stranger could learn by guessing does: `not_found`, `inactive`, `expired` and
 * `exhausted` each answer "does this code exist". `already_used` cannot be elicited by anybody but
 * the person who already holds the code, so charging for it only punishes a customer — one who
 * abandons a payment page gets it back on every retry for half an hour, and five of those would lock
 * them out of checking any code at all.
 */
const isGuess = (error: CheckoutError) => isPromoRefusal(error) && error !== 'promo_already_used';

export const actions = {
	/**
	 * tech.md 10, steps 1-5. The form posts what tech.md 10 step 1 says it posts — a plan id and,
	 * optionally, the name of a promo code — and the server prices the order from the rows those two
	 * name. There is deliberately nowhere in this action to say what anything costs (CLAUDE.md 2).
	 */
	createCheckout: async ({ request, locals }) => {
		/**
		 * The guard in hooks.server.ts already 401s a POST without a session. This is the second
		 * check tech.md 9 asks for rather than a copy of the first: an order belongs to a person,
		 * and that person comes off the session, never off the form.
		 */
		if (!locals.user) {
			return fail(401, { message: 'Откройте приложение из Telegram, чтобы оплатить.' });
		}

		const parsed = checkoutInput.parse(Object.fromEntries(await request.formData()));
		if (!parsed.ok) return fail(400, { message: parsed.error } satisfies CheckoutFailure);

		// The full row: the checkout needs stripeCustomerId, which SessionUser does not carry.
		const user = users.findById(locals.user.id);
		if (!user) {
			return fail(401, { message: 'Откройте приложение из Telegram, чтобы оплатить.' });
		}

		const promoCode = parsed.value.promoCode;
		const limiterKey = String(locals.user.id);

		/**
		 * CLAUDE.md 2: five promo attempts per ten minutes per person. Peeked here and spent below,
		 * only on a refusal that tells a guesser something — a code that works, or one they have
		 * already used themselves, teaches them nothing they did not already know. A purchase with no
		 * code never touches the budget at all.
		 *
		 * Read once: two calls straddling the window reset would print the wait from a fresh budget
		 * next to a refusal issued against the spent one.
		 */
		if (promoCode) {
			const budget = promoLimiter.peek(limiterKey);
			if (!budget.allowed) {
				return fail(429, {
					message: promoRateLimitMessage(budget.retryAfterSec)
				} satisfies CheckoutFailure);
			}
		}

		try {
			const started = await checkout.start(user, parsed.value.planId, promoCode);

			if (!started.ok) {
				const rule = CHECKOUT_RULES[started.error];

				if (isPromoRefusal(started.error)) {
					if (isGuess(started.error)) promoLimiter.consume(limiterKey);
					// The reason, never the code: a working promo code is a bearer secret (CLAUDE.md 2).
					log.info('checkout_promo_refused', {
						requestId: locals.requestId,
						reason: started.error
					});
				}

				return fail(rule.status, { message: rule.message } satisfies CheckoutFailure);
			}

			return { url: started.value.url, orderId: started.value.orderId };
		} catch (err) {
			const { status, body } = toHttp(err, locals.requestId);

			if (err instanceof AppError) {
				log.warn('checkout_refused', { requestId: locals.requestId, code: err.code, status });
			} else {
				log.error('checkout_failed', { requestId: locals.requestId, error: err });
			}

			// The provider's own words never reach the person: toHttp has already replaced them.
			return fail(status, { message: body.message } satisfies CheckoutFailure);
		}
	}
} satisfies Actions;
