import * as v from 'valibot';
import type { UserService } from '$lib/server/auth/user-service';
import type { OrderService, PromoService } from '$lib/server/billing';
import type { MarzbanApi, MarzbanUser } from '$lib/server/clients/marzban';
import type { OrderRow } from '$lib/server/db/schema';
import { MarzbanError } from '$lib/server/errors';
import type { Logger } from '$lib/server/log';
import { foldTerms, isActiveAt, type PaidTerm } from '$lib/server/subscriptions';
import type { SubscriptionService } from '$lib/server/subscriptions';
import { JobHandler } from '../handler';
import type { JobQueue } from '../queue';

const PayloadSchema = v.object({ orderId: v.number() });

/** One Marzban user per person, named for their Telegram id (tech.md 17.4). */
const marzbanUsernameOf = (telegramId: number) => `tg_${telegramId}`;

/**
 * Dates are rendered in UTC so the same order always produces the same sentence, whatever timezone
 * the container happens to be in. Telegram gives us no reliable timezone for the reader anyway.
 */
const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
	day: 'numeric',
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC'
});

export interface SubscriptionProvisionOptions {
	now?: () => number;
	/**
	 * Where an overspent promo is reported. Required, like its two sibling handlers: made optional it
	 * would default to "tell nobody", and the one thing this alert exists for is the case where money
	 * was taken on a discount the shop had already run out of.
	 */
	adminChatId: number;
}

/**
 * Turns a paid order into working VPN access (tech.md 6, A8): Marzban first, then our own row, then
 * the message with the link.
 *
 * ## Idempotency
 *
 * Two runs of the same payload must leave exactly one effect (tech.md 6), and this handler really
 * does get run twice: a failed attempt is retried, and the worker deliberately re-runs a job that a
 * dying process left `running` (jobs/worker.ts, recoverOrphans).
 *
 * So nothing here increments anything. The end date is folded from the person's paid orders
 * (subscriptions/expiry.ts), which makes it a pure function of the database rather than of how many
 * times this ran; the Marzban calls set an absolute expiry rather than adding days; the row is
 * overwritten rather than updated in place; and the message rides a dedupe key tied to the order.
 * Run it a hundred times and the second run onwards changes nothing.
 *
 * ## Order of operations
 *
 * Marzban before the local write, on purpose. If the panel call succeeds and the write then fails,
 * the retry redoes both and converges. The other order would leave a row claiming access that was
 * never granted — and tech.md 1 makes Marzban, not us, the source of truth about access.
 */
export class SubscriptionProvisionHandler extends JobHandler<'subscription.provision'> {
	readonly type = 'subscription.provision';
	readonly schema = PayloadSchema;

	private readonly now: () => number;
	private readonly adminChatId: number;

	constructor(
		private readonly orders: OrderService,
		private readonly subscriptions: SubscriptionService,
		private readonly users: UserService,
		private readonly promos: PromoService,
		private readonly marzban: MarzbanApi,
		private readonly jobs: JobQueue,
		private readonly log: Logger,
		opts: SubscriptionProvisionOptions
	) {
		super();
		this.now = opts.now ?? Date.now;
		this.adminChatId = opts.adminChatId;
	}

	async handle(payload: v.InferOutput<typeof PayloadSchema>): Promise<void> {
		const order = this.orders.findById(payload.orderId);
		if (!order) throw new Error(`order ${payload.orderId} is gone`);

		/**
		 * The webhook enqueues this job inside the transaction that marks the order paid, so by the
		 * time the row is visible to the worker the payment is committed too. Anything else means
		 * somebody enqueued by hand, and granting access on it would hand out a free subscription.
		 */
		if (order.status !== 'paid') {
			throw new Error(`order ${order.id} is ${order.status}, not paid`);
		}

		const user = this.users.findById(order.userId);
		if (!user) throw new Error(`order ${order.id} belongs to a user that is gone`);

		const term = foldTerms(this.#termsOf(order.userId));
		if (!term) throw new Error(`order ${order.id} is paid but folds to no term`);

		const username = marzbanUsernameOf(user.telegramId);
		const marzbanUser = await this.#applyToMarzban(username, term.expiresAtMs, order.planSnapshot);

		const subscription = this.subscriptions.upsert({
			userId: user.id,
			planId: order.planId,
			marzbanUsername: username,
			// Marzban owns the link (tech.md 1) and normalises it to an absolute URL in its client.
			subscriptionUrl: marzbanUser.subscriptionUrl,
			startsAtMs: term.startsAtMs,
			expiresAtMs: term.expiresAtMs,
			status: isActiveAt(term.expiresAtMs, this.now()) ? 'active' : 'expired'
		});

		this.log.info('subscription_provisioned', {
			orderId: order.id,
			userId: user.id,
			subscriptionId: subscription.id,
			expiresAt: term.expiresAtMs
		});

		this.#redeemPromo(order);
		this.#announce(user.telegramId, order.id, term.expiresAtMs, marzbanUser.subscriptionUrl);
	}

	/**
	 * tech.md 6 makes redeeming the code an effect of this job, not of the webhook: the discount is
	 * spent when the access it bought is granted, so a payment that never provisions never burns a
	 * use. It runs after the subscription is written for the same reason — a Marzban outage that
	 * fails this job repeatedly must not eat the code on every attempt.
	 *
	 * Idempotent: PromoService refuses a second redemption for the same order or the same person, and
	 * the counter moves only when a row is written.
	 */
	#redeemPromo(order: OrderRow): void {
		if (order.promoCodeId === null) return;

		const outcome = this.promos.redeem({
			promoCodeId: order.promoCodeId,
			userId: order.userId,
			orderId: order.id
		});

		if (outcome === 'redeemed') {
			// The id, never the code itself: this line ends up in stdout, and a working promo code is a
			// bearer secret (CLAUDE.md 2).
			this.log.info('promo_redeemed', { orderId: order.id, promoCodeId: order.promoCodeId });
			return;
		}

		if (outcome === 'already_redeemed') return;

		/**
		 * The code ran out between the quote and the payment — somebody else took the last use while
		 * this person was on the payment page.
		 *
		 * Access is granted anyway, and that is deliberate: the money is already taken, and refusing
		 * the subscription over a discount the shop itself quoted would be the far worse failure. What
		 * is lost is one use beyond `maxUses`, so the admin hears about it and the ledger stays honest.
		 */
		this.log.warn('promo_overspent', {
			orderId: order.id,
			userId: order.userId,
			promoCodeId: order.promoCodeId
		});

		const dedupeKey = `promo:overspent:${order.id}`;
		this.jobs.enqueue(
			'telegram.send_message',
			{
				chatId: this.adminChatId,
				text: `Заказ ${order.publicId} оплачен со скидкой, но лимит промокода уже был выбран. Доступ выдан, использование не засчитано.`,
				dedupeKey
			},
			`tg:${dedupeKey}`
		);
	}

	/**
	 * Every paid order of this person, oldest payment first. A row that is somehow paid without a
	 * timestamp is skipped rather than counted as epoch zero, which would silently swallow a period:
	 * markPaid writes both columns in one statement, so this cannot happen without a hand edit.
	 */
	#termsOf(userId: number): PaidTerm[] {
		const terms: PaidTerm[] = [];

		for (const row of this.orders.listPaid(userId)) {
			if (!row.paidAt) {
				this.log.warn('order_paid_without_timestamp', { orderId: row.id });
				continue;
			}
			terms.push({ paidAtMs: row.paidAt.getTime(), durationDays: row.planSnapshot.durationDays });
		}

		return terms;
	}

	/**
	 * Creates the panel user on the first purchase and moves the expiry on every one after.
	 * `setExpiry` writes an absolute moment, never a delta, which is what makes a retry harmless.
	 */
	async #applyToMarzban(
		username: string,
		expiresAtMs: number,
		plan: { trafficLimitBytes: number; name: string }
	): Promise<MarzbanUser> {
		const existing = await this.marzban.getUser(username);

		if (!existing) {
			try {
				return await this.marzban.createUser({
					username,
					expiresAtMs,
					/**
					 * Set once, at creation. MarzbanApi (tech.md 8, frozen) exposes no way to change a
					 * data limit afterwards, so a renewal onto a plan with a different allowance cannot
					 * move it. Every seeded plan is unlimited (0), so nothing is wrong today — but a
					 * metered plan would need a contract change before it could be sold.
					 */
					dataLimitBytes: plan.trafficLimitBytes,
					note: plan.name
				});
			} catch (error) {
				// Lost a race, or a retry that got further than we thought: the user now exists and
				// setting the expiry gets us to the same place createUser would have.
				if (!(error instanceof MarzbanError) || error.status !== 409) throw error;
				this.log.warn('marzban_user_already_existed', { username });
			}
		}

		const updated = await this.marzban.setExpiry(username, expiresAtMs);

		// A lapsed subscription leaves the panel user switched off; paying again has to switch it
		// back on. 'limited' is left alone — that is traffic, and more days will not fix it.
		if (updated.status === 'disabled' || updated.status === 'expired') {
			await this.marzban.setStatus(username, 'active');
			return { ...updated, status: 'active' };
		}

		return updated;
	}

	/**
	 * tech.md 6: the provision ends with a message carrying the link. One per order, held to that by
	 * the queue's unique idempotency key — a retried job re-enqueues and the insert is a no-op.
	 */
	#announce(chatId: number, orderId: number, expiresAtMs: number, url: string): void {
		const dedupeKey = `subscription:order:${orderId}`;

		this.jobs.enqueue(
			'telegram.send_message',
			{
				chatId,
				text: `Подписка активна до ${DATE_FORMAT.format(new Date(expiresAtMs))}.\n\nВаша ссылка:\n${url}`,
				dedupeKey
			},
			`tg:${dedupeKey}`
		);
	}
}
