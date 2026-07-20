import * as v from 'valibot';
import type { UserService } from '$lib/server/auth/user-service';
import type { Logger } from '$lib/server/log';
import type { PlanService } from '$lib/server/plans';
import { daysLeft, type SubscriptionService } from '$lib/server/subscriptions';
import { JobHandler } from '../handler';
import type { JobQueue } from '../queue';

const PayloadSchema = v.object({
	subscriptionId: v.number(),
	// tech.md 6 fixes the marks at 3 and 1. A payload naming any other number was never ours.
	daysLeft: v.picklist([3, 1] as const)
});

export interface SubscriptionNotifyExpiryOptions {
	now?: () => number;
}

/**
 * How the app writes a date in an outgoing message.
 *
 * Deliberately not imported from `routes/(app)/dates.ts`, which is the same format for the screens:
 * `$lib/server` sits below the routes and must not reach up into them, and the frozen folder layout
 * (tech.md 4) offers no shared non-server module to put one copy in. `plans/input.ts` documents the
 * same split for gigabytes and bytes. Both copies are one `Intl` option bag; the day they need to
 * agree on something subtler than that, the shared module belongs in the CONTRACT GAP that adds it.
 *
 * No year, for the reason `dates.ts` gives its own short format: the year is noise on a date at most
 * three days away. It also keeps the sentence readable — ru-RU renders a year as «17 июля 2026 г.»,
 * whose trailing period would collide with the one ending the clause.
 */
const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

/** Russian needs the noun to agree with the number, and there are exactly two numbers to cover. */
const DAY_WORD: Record<3 | 1, string> = { 3: 'дня', 1: 'день' };

/**
 * Tells one person their subscription is about to end (A15). Scheduled by the sweep at three days
 * left and at one, and at nothing else (tech.md 6).
 *
 * ## Why this hands the message to `telegram.send_message` instead of sending it
 *
 * tech.md 6 says this job's effect is "одно сообщение о скором окончании", and the only durable way
 * to hold it to "one" is a unique key. `subscriptions` has no `notifiedAt` column and the schema is
 * frozen (tech.md 15), so there is nothing here to write and then read back as proof a send already
 * happened — the guard `SupportNotifyAdminHandler` leans on does not exist for this job.
 *
 * So the guarantee is moved to where it can be enforced: this handler enqueues under
 * `tg:expiry:<subscriptionId>:<daysLeft>`, and the unique index refuses the second one. Running this
 * handler ten times produces ten insert attempts and one message.
 *
 * That is the exact inverse of the argument in `SupportNotifyAdminHandler`, and on purpose: that job
 * has to know the id of the message it produced, which a queued send cannot report back, and it has
 * a `deliveredAt` column to prove delivery with. This one needs neither.
 */
export class SubscriptionNotifyExpiryHandler extends JobHandler<'subscription.notify_expiry'> {
	readonly type = 'subscription.notify_expiry';
	readonly schema = PayloadSchema;

	private readonly now: () => number;

	constructor(
		private readonly subscriptions: SubscriptionService,
		private readonly users: UserService,
		private readonly plans: PlanService,
		private readonly jobs: JobQueue,
		private readonly log: Logger,
		opts: SubscriptionNotifyExpiryOptions = {}
	) {
		super();
		this.now = opts.now ?? Date.now;
	}

	async handle(payload: v.InferOutput<typeof PayloadSchema>): Promise<void> {
		const subscription = this.subscriptions.findById(payload.subscriptionId);
		// Rows are never deleted here, so this is a payload that was never real. Retrying cannot
		// conjure it, but throwing is still right: the queue records it and alerts the admin.
		if (!subscription) throw new Error(`subscription ${payload.subscriptionId} is gone`);

		const expiresAtMs = subscription.expiresAt.getTime();
		const now = this.now();

		/**
		 * The fact is rechecked, not trusted, because the job may have waited. A failed attempt is
		 * retried with backoff up to an hour (tech.md 6) and an orphan is re-run after a restart, so
		 * between the sweep that scheduled this and the run that executes it the person may have
		 * renewed — and "заканчивается через 1 день" sent to somebody who just bought 90 more is
		 * worse than silence. `revoked` is the same case: a decision, not a date.
		 */
		if (subscription.status !== 'active') {
			this.log.info('subscription_expiry_notice_skipped', {
				subscriptionId: subscription.id,
				reason: subscription.status
			});
			return;
		}

		const left = daysLeft(expiresAtMs, now);

		if (left !== payload.daysLeft) {
			this.log.info('subscription_expiry_notice_stale', {
				subscriptionId: subscription.id,
				scheduledFor: payload.daysLeft,
				actual: left
			});
			return;
		}

		const owner = this.users.findById(subscription.userId);
		if (!owner) throw new Error(`subscription ${subscription.id} belongs to a user that is gone`);

		const plan = this.plans.findById(subscription.planId);
		if (!plan) throw new Error(`subscription ${subscription.id} names a plan that is gone`);

		// The whole idempotency guarantee, in one string (tech.md 6).
		const dedupeKey = `expiry:${subscription.id}:${payload.daysLeft}`;

		this.jobs.enqueue(
			'telegram.send_message',
			{
				chatId: owner.telegramId,
				text: this.#compose(plan.name, payload.daysLeft, expiresAtMs),
				dedupeKey
			},
			`tg:${dedupeKey}`
		);

		this.log.info('subscription_expiry_notice_queued', {
			subscriptionId: subscription.id,
			daysLeft: payload.daysLeft
		});
	}

	/**
	 * Plain text, no parse_mode: a plan name is typed by an admin, and under HTML an unbalanced tag
	 * would turn every warning into a 400 from Bot API.
	 *
	 * Copy per tech.md 11: active voice, sentence case, and the button-equivalent names the action —
	 * the sentence says what to do, not merely that something is ending.
	 */
	#compose(planName: string, days: 3 | 1, expiresAtMs: number): string {
		return (
			`Подписка «${planName}» заканчивается через ${days} ${DAY_WORD[days]}, ${DATE.format(new Date(expiresAtMs))}. ` +
			`Продлите её в приложении, чтобы доступ не прервался.`
		);
	}
}
