import Stripe from 'stripe';
import * as v from 'valibot';
import { PaymentProviderError, PaymentSignatureError } from '$lib/server/errors';
import type { OrderRow, UserRow } from '$lib/server/db/schema';
import { CURRENCIES, type Currency, type PlanSnapshot } from '$lib/types';
import type { PaymentEvent, PaymentProvider } from './types';

/** tech.md 10: a checkout link is good for 30 minutes. Stripe wants the deadline in SECONDS. */
const CHECKOUT_TTL_SEC = 30 * 60;

/**
 * The slice of the Stripe SDK we actually call, expressed in our own types. Two jobs:
 * it keeps Stripe's types from escaping this module (CLAUDE.md 3), and it lets tests inject a
 * stub instead of reaching the network. A real `new Stripe(key)` satisfies it structurally.
 */
export interface StripeGateway {
	checkout: {
		sessions: {
			create(params: CheckoutSessionCreateParams): Promise<{ id: string; url: string | null }>;
		};
	};
	webhooks: {
		constructEvent(
			rawBody: string,
			signature: string,
			secret: string
		): { id: string; type: string; data: { object: unknown } };
	};
}

/** Exactly the payload tech.md 10 documents — no coupons, no promotion codes, no subscriptions. */
export interface CheckoutSessionCreateParams {
	mode: 'payment';
	client_reference_id: string;
	metadata: Record<string, string>;
	customer?: string;
	customer_creation?: 'always';
	line_items: Array<{
		quantity: number;
		price_data: {
			currency: string;
			unit_amount: number;
			product_data: { name: string; description: string };
		};
	}>;
	success_url: string;
	cancel_url: string;
	expires_at: number;
}

export interface StripePaymentsOptions {
	secretKey: string;
	webhookSecret: string;
	priceCurrency: Currency;
	returnDeeplink: string;
	/** Injectable gateway for tests. Production leaves it out and gets the real SDK. */
	stripe?: StripeGateway;
}

/** Shape we read off a signed checkout.session.* payload. Unknown keys are dropped. */
const CheckoutSessionSchema = v.object({
	id: v.string(),
	client_reference_id: v.nullish(v.string()),
	payment_status: v.nullish(v.string()),
	payment_intent: v.nullish(v.union([v.string(), v.object({ id: v.string() })])),
	amount_total: v.nullish(v.number()),
	currency: v.nullish(v.string()),
	metadata: v.nullish(v.record(v.string(), v.string()))
});

type CheckoutSession = v.InferOutput<typeof CheckoutSessionSchema>;

export class StripePayments implements PaymentProvider {
	readonly id = 'stripe';

	readonly #stripe: StripeGateway;
	readonly #webhookSecret: string;
	readonly #priceCurrency: Currency;
	readonly #returnDeeplink: string;

	constructor(options: StripePaymentsOptions) {
		this.#stripe = options.stripe ?? new Stripe(options.secretKey);
		this.#webhookSecret = options.webhookSecret;
		this.#priceCurrency = options.priceCurrency;
		this.#returnDeeplink = options.returnDeeplink;
	}

	async createCheckout(
		order: OrderRow,
		plan: PlanSnapshot,
		user: UserRow
	): Promise<{ url: string; sessionId: string }> {
		const session = await this.#stripe.checkout.sessions.create({
			mode: 'payment',
			client_reference_id: order.publicId,
			metadata: { orderId: String(order.id), publicId: order.publicId },
			customer: user.stripeCustomerId ?? undefined,
			customer_creation: user.stripeCustomerId ? undefined : 'always',
			line_items: [
				{
					quantity: 1,
					price_data: {
						currency: this.#priceCurrency,
						// The server-side quote already carries the discount: Stripe coupons would be a
						// second discount system, and price history must stay in planSnapshot alone.
						unit_amount: order.finalPriceMinor,
						product_data: { name: plan.name, description: `${plan.durationDays} дней` }
					}
				}
			],
			success_url: `${this.#returnDeeplink}?startapp=order_${order.publicId}`,
			cancel_url: `${this.#returnDeeplink}?startapp=cancel_${order.publicId}`,
			expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SEC
		});

		if (session.url === null) {
			throw new PaymentProviderError(
				`stripe returned checkout session ${session.id} without a url`
			);
		}

		return { url: session.url, sessionId: session.id };
	}

	parseWebhook(rawBody: string, signature: string): PaymentEvent {
		let event: { id: string; type: string; data: { object: unknown } };
		try {
			event = this.#stripe.webhooks.constructEvent(rawBody, signature, this.#webhookSecret);
		} catch (cause) {
			throw new PaymentSignatureError('stripe webhook signature verification failed', { cause });
		}

		switch (event.type) {
			case 'checkout.session.completed': {
				const session = toSession(event.data.object);
				// Deferred methods complete the session before the money lands, so completion alone
				// is not payment. Waiting for async_payment_succeeded is the whole point of this check.
				return session.payment_status === 'paid'
					? paidEvent(event.id, session)
					: { kind: 'ignored', eventId: event.id };
			}
			case 'checkout.session.async_payment_succeeded':
				return paidEvent(event.id, toSession(event.data.object));
			case 'checkout.session.async_payment_failed':
				return failedEvent(event.id, toSession(event.data.object), 'async_payment_failed');
			case 'checkout.session.expired':
				return failedEvent(event.id, toSession(event.data.object), 'expired');
			default:
				return { kind: 'ignored', eventId: event.id };
		}
	}
}

function toSession(object: unknown): CheckoutSession {
	const result = v.safeParse(CheckoutSessionSchema, object);
	if (!result.success) {
		throw new PaymentProviderError('stripe checkout session payload has an unexpected shape');
	}
	return result.output;
}

/** Our own sessions always carry it; a session without one was created outside this app. */
function orderPublicIdOf(session: CheckoutSession): string | null {
	return session.client_reference_id ?? session.metadata?.publicId ?? null;
}

function paidEvent(eventId: string, session: CheckoutSession): PaymentEvent {
	const orderPublicId = orderPublicIdOf(session);
	if (orderPublicId === null) return { kind: 'ignored', eventId };

	// From here the money is ours and unattributable data must alert, not vanish silently.
	const paymentIntentId =
		typeof session.payment_intent === 'string'
			? session.payment_intent
			: (session.payment_intent?.id ?? null);
	if (paymentIntentId === null) {
		throw new PaymentProviderError(
			`checkout session ${session.id} is paid without a payment intent`
		);
	}
	if (typeof session.amount_total !== 'number') {
		throw new PaymentProviderError(`checkout session ${session.id} is paid without an amount`);
	}
	if (!isCurrency(session.currency)) {
		throw new PaymentProviderError(
			`checkout session ${session.id} carries unsupported currency ${session.currency}`
		);
	}

	return {
		kind: 'paid',
		eventId,
		orderPublicId,
		sessionId: session.id,
		paymentIntentId,
		amountMinor: session.amount_total,
		currency: session.currency
	};
}

function failedEvent(eventId: string, session: CheckoutSession, reason: string): PaymentEvent {
	const orderPublicId = orderPublicIdOf(session);
	if (orderPublicId === null) return { kind: 'ignored', eventId };
	return { kind: 'failed', eventId, orderPublicId, reason };
}

function isCurrency(value: string | null | undefined): value is Currency {
	return CURRENCIES.some((currency) => currency === value);
}
