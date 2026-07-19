import type { OrderDTO, SubscriptionDTO } from '$lib/types';
import { toOrderDTO, type OrderService } from '../billing';
import type { PlanService } from '../plans';
import { foldTerms, type PaidTerm } from './expiry';
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

		return {
			subscription,
			latestOrder,
			awaitingKey: this.#awaitingKey(userId, subscription, latestOrder)
		};
	}

	/**
	 * True while a paid order has not yet reached the subscription row.
	 *
	 * The test is arithmetic rather than a flag, because there is no column to hold a flag: the
	 * schema is frozen (tech.md 15) and carries nothing marking which order was last provisioned.
	 * So the reader recomputes what the job would write — the same fold over the same paid orders
	 * (expiry.ts) — and compares. `subscription.provision` overwrites the row with exactly that
	 * value, so the row matches the fold if and only if the job has caught up.
	 *
	 * It has to be the whole fold, not the latest order's own duration: `foldTerms` extends from
	 * `max(the running end, the moment it was paid)`, so a renewal bought while a longer term is
	 * still running already sits past `paidAt + durationDays` before the job touches it. Testing
	 * against that shorter figure would call the key delivered the instant the webhook lands — the
	 * banner would say «Готово», polling would stop for good, and the days bought would not show up
	 * until the person next reloaded the app.
	 */
	#awaitingKey(
		userId: number,
		subscription: SubscriptionDTO | null,
		order: OrderDTO | null
	): boolean {
		if (order?.status !== 'paid') return false;
		if (!subscription) return true;

		const term = foldTerms(this.#termsOf(userId));

		return term !== null && subscription.expiresAt < term.expiresAtMs;
	}

	/**
	 * Every paid order of this person, oldest payment first — the same input
	 * `SubscriptionProvisionHandler` folds. A row somehow paid without a timestamp is skipped rather
	 * than counted as epoch zero, exactly as the handler skips it, so the two cannot disagree.
	 */
	#termsOf(userId: number): PaidTerm[] {
		const terms: PaidTerm[] = [];

		for (const row of this.orders.listPaid(userId)) {
			if (!row.paidAt) continue;
			terms.push({ paidAtMs: row.paidAt.getTime(), durationDays: row.planSnapshot.durationDays });
		}

		return terms;
	}
}
