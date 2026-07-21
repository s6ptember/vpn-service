import { redirect } from '@sveltejs/kit';
import { access } from '$lib/server/container';
import type { PageServerLoad } from './$types';

/**
 * The install instructions only mean anything with a live key behind them. Reached exclusively from
 * Главная's «Установить и настроить» once a purchase exists (routes/(app)/+page.svelte) — anybody
 * arriving any other way (no session, a bookmark, a lapsed subscription) is sent back rather than
 * shown a QR for a link that no longer works.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, '/');

	const { subscription } = access.forUser(locals.user.id);
	if (!subscription || subscription.status !== 'active') redirect(302, '/');

	return { subscription };
};
