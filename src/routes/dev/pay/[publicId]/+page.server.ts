import { error, fail } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { FakePayments, FAKE_WEBHOOK_SECRET } from '$lib/server/clients/payments';
import { clients, orders } from '$lib/server/container';
import type { Actions, PageServerLoad } from './$types';

/**
 * The one-button payment page tech.md 8 describes: `FakePayments.createCheckout` already returns
 * `/dev/pay/<publicId>` as its url, so without this route a developer's Купить leads to a 404.
 *
 * Clicking Оплатить builds the event Stripe would have sent and posts it to our own webhook, over
 * HTTP, with the signature header. So the whole path — route, signature check, dedupe, amount
 * check, job, Marzban — runs in dev exactly as it will in production, with no Stripe traffic.
 *
 * hooks.server.ts 404s everything under /dev outside `vite dev`, and this route refuses again on
 * its own: a page that mints paid orders should not depend on one guard remembering it exists.
 */

function requireFake(): FakePayments {
	if (!dev) error(404, 'not found');

	const payments = clients.payments;
	if (!(payments instanceof FakePayments)) {
		error(404, 'not found');
	}

	return payments;
}

export const load: PageServerLoad = async ({ params }) => {
	requireFake();

	const order = orders.findByPublicId(params.publicId);
	if (!order) error(404, 'not found');

	return {
		publicId: order.publicId,
		status: order.status,
		amountMinor: order.finalPriceMinor,
		currency: order.currency,
		plan: order.planSnapshot
	};
};

export const actions = {
	pay: async ({ params, fetch }) => {
		const payments = requireFake();

		const event = payments.simulatePaid(params.publicId);

		const response = await fetch('/api/stripe/webhook', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'stripe-signature': FAKE_WEBHOOK_SECRET },
			body: JSON.stringify(event)
		});

		if (!response.ok) {
			return fail(502, { message: `Вебхук ответил ${response.status}` });
		}

		return { message: 'Оплата подтверждена. Возвращайтесь в мини-апп.' };
	}
} satisfies Actions;
