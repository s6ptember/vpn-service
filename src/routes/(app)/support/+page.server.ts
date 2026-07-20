import { faq } from '$lib/server/container';
import type { PageServerLoad } from './$types';

/**
 * A13 — the FAQ accordion, read from `faq_items` (tech.md 11).
 *
 * Nothing here is personal, so this load never looks at `locals.user`: the questions are the same
 * for everybody and they render on the very first pass, before the cookie lands (tech.md 9). That
 * is the whole point of putting them on the section somebody opens when something is already
 * broken — an answer that waits for a handshake is an answer that arrives too late.
 */
export const load: PageServerLoad = async () => {
	return { faq: faq.listActive() };
};
