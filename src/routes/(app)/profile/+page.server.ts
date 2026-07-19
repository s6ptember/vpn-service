import { access } from '$lib/server/container';
import type { PageServerLoad } from './$types';

/**
 * A9 — the active plan, the end date, the link and the QR.
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
	if (!locals.user) return { subscription: null, latestOrder: null, awaitingKey: false };

	return access.forUser(locals.user.id);
};
