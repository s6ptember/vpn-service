import { plans } from '$lib/server/container';
import type { PageServerLoad } from './$types';

/**
 * Reference slice: load returns DTOs from the domain, never DB rows (CLAUDE.md 1.4).
 *
 * Plans are public, so this survives locals.user === null and renders the same list to a signed-out
 * shell (tech.md 9). Exactly one render lives in that state before the cookie lands.
 */
export const load: PageServerLoad = async () => ({ plans: plans.listActive() });
