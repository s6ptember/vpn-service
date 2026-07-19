import type { OrderDTO, SubscriptionDTO } from '$lib/types';
import { toOrderDTO, type OrderService } from '../billing';
import type { PlanService } from '../plans';
import { DAY_MS } from './expiry';
import { toSubscriptionDTO } from './mapper';
import type { SubscriptionService } from './subscription-service';

export interface AccessView {
	subscription: SubscriptionDTO | null;
	/** The order the person is most likely looking at. Drives the "Ждём оплату" screen (A7). */
	latestOrder: OrderDTO | null;
	/**
	 * The payment landed and the key is not out yet — `subscription.provision` is queued or running.
	 *
	 * It exists because "paid" and "usable" are not the same moment: the webhook only enqueues the
	 * job, and Marzban is called seconds later by the worker. Without this flag the profile would
	 * greet somebody who has just paid with «Подписки нет» and an invitation to buy.
	 */
	awaitingKey: boolean;
}

export interface SubscriptionReaderOptions {
	now?: () => number;
}

/**
 * What a page needs to say about one person's access, assembled once.
 *
 * It reaches across three domains on purpose: the answer genuinely spans them, and the alternative
 * is the home page and the profile page each stitching the same three reads together and drifting
 * apart on the fourth. Nothing here writes.
 */
export class SubscriptionReader {
	private readonly now: () => number;

	constructor(
		private readonly subscriptions: SubscriptionService,
		private readonly orders: OrderService,
		private readonly plans: PlanService,
		opts: SubscriptionReaderOptions = {}
	) {
		this.now = opts.now ?? Date.now;
	}

	forUser(userId: number): AccessView {
		const nowMs = this.now();
		const row = this.subscriptions.findByUser(userId);
		const latest = this.orders.latest(userId);

		const subscription = row
			? toSubscriptionDTO(
					row,
					// The plan may have been renamed or archived since; the name on screen should be the
					// one it carries today. A plan that is gone entirely leaves a neutral word rather
					// than an empty line.
					this.plans.findById(row.planId)?.name ?? 'Подписка',
					nowMs
				)
			: null;

		const latestOrder = latest ? toOrderDTO(latest) : null;

		return { subscription, latestOrder, awaitingKey: awaitingKey(subscription, latestOrder) };
	}
}

/**
 * True while a paid order has not yet reached the subscription row.
 *
 * The test is arithmetic rather than a flag, because there is no column to hold a flag: under the
 * expiry fold (expiry.ts) a provisioned order always leaves `expiresAt` at least its own duration
 * past its payment — exactly that for a first purchase, strictly more for a renewal. So the moment
 * the row satisfies this, the job has run.
 */
function awaitingKey(subscription: SubscriptionDTO | null, order: OrderDTO | null): boolean {
	if (order?.status !== 'paid' || order.paidAt === null) return false;
	if (!subscription) return true;

	return subscription.expiresAt < order.paidAt + order.plan.durationDays * DAY_MS;
}
