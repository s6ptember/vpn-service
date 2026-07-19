import { fail } from '@sveltejs/kit';
import { access, checkout, checkoutInput, plans, users } from '$lib/server/container';
import { AppError, toHttp } from '$lib/server/errors';
import { log } from '$lib/server/log';
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
		: { subscription: null, latestOrder: null, awaitingKey: false };

	return { plans: plans.listActive(), ...view };
};

/** What the page gets back from a refused checkout. A success carries the link instead. */
interface CheckoutFailure {
	message: string;
}

export const actions = {
	/**
	 * tech.md 10, steps 1-5. The form posts one field — the plan id — and the server prices the
	 * order from the plan row. There is deliberately nowhere in this action to say what anything
	 * costs (CLAUDE.md 2).
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

		try {
			const started = await checkout.start(user, parsed.value.planId);

			if (!started.ok) {
				// A stale card: the plan was hidden or archived while this page sat open.
				return fail(409, {
					message: 'Этот тариф больше не продаётся. Выберите другой.'
				} satisfies CheckoutFailure);
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
