import type { OrderRow, UserRow } from '$lib/server/db/schema';
import type { Currency, PlanSnapshot } from '$lib/types';

export interface PaymentProvider {
	readonly id: 'stripe' | 'fake';
	/** Creates a checkout session and returns the link the client opens via WebApp.openLink. */
	createCheckout(
		order: OrderRow,
		plan: PlanSnapshot,
		user: UserRow
	): Promise<{ url: string; sessionId: string }>;
	/** Verifies the raw body signature and maps the provider event onto our type.
	 *  Throws PaymentSignatureError. Stripe SDK types never leave this folder. */
	parseWebhook(rawBody: string, signature: string): PaymentEvent;
}

export type PaymentEvent =
	| {
			kind: 'paid';
			eventId: string;
			orderPublicId: string;
			sessionId: string;
			paymentIntentId: string;
			amountMinor: number;
			currency: Currency;
	  }
	| { kind: 'failed'; eventId: string; orderPublicId: string; reason: string }
	| { kind: 'ignored'; eventId: string };
