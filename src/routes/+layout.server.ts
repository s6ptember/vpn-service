import type { LayoutServerLoad } from './$types';

/**
 * The session user goes down the whole tree from one place. Routes never parse the cookie
 * themselves — the guard in hooks.server.ts already put it on locals.
 */
export const load: LayoutServerLoad = async ({ locals }) => ({ user: locals.user });
