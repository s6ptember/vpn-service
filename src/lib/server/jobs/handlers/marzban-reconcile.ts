import * as v from 'valibot';
import type { MarzbanApi } from '$lib/server/clients/marzban';
import type { Logger } from '$lib/server/log';
import { isActiveAt, type SubscriptionService } from '$lib/server/subscriptions';
import { JobHandler } from '../handler';

const PayloadSchema = v.object({ subscriptionId: v.number() });

export interface MarzbanReconcileOptions {
	now?: () => number;
}

/**
 * Pushes what we believe about one subscription back onto the panel (A16, tech.md 6).
 *
 * ## Which side wins
 *
 * tech.md 6 is explicit: "локальное состояние — ведущее". That is not arbitrary — tech.md 1 splits
 * the two systems so that Marzban owns *access* while this app owns *who access is owed to*, and
 * that ownership is the whole reason the app never reads the panel's database. So a disagreement is
 * resolved by writing to Marzban, never by reading from it. Copying `expire` back into
 * `subscriptions` would let a hand-edit in the panel silently extend a subscription nobody paid
 * for, and the money — orders, promo redemptions — would still say otherwise.
 *
 * So this handler only ever writes outward, and the local row is left exactly as it was found.
 *
 * ## Idempotency
 *
 * Structural, and stronger than a guard: every call is a comparison first. The first run pushes the
 * fields that differ; the second finds nothing different and makes no call at all. Running it ten
 * times converges on the same panel state as running it once, which is what tech.md 6 asks of every
 * handler — and it is why this job is safe to hang off a button an admin can double-tap.
 *
 * The hour-long idempotency key the admin screen enqueues under (`reconcile:<id>:<hour>`) is a
 * separate, coarser protection: it stops the *queue* filling with identical work. This is what makes
 * the work itself harmless when it does run twice.
 */
export class MarzbanReconcileHandler extends JobHandler<'marzban.reconcile'> {
	readonly type = 'marzban.reconcile';
	readonly schema = PayloadSchema;

	private readonly now: () => number;

	constructor(
		private readonly subscriptions: SubscriptionService,
		private readonly marzban: MarzbanApi,
		private readonly log: Logger,
		opts: MarzbanReconcileOptions = {}
	) {
		super();
		this.now = opts.now ?? Date.now;
	}

	async handle(payload: v.InferOutput<typeof PayloadSchema>): Promise<void> {
		const subscription = this.subscriptions.findById(payload.subscriptionId);
		if (!subscription) throw new Error(`subscription ${payload.subscriptionId} is gone`);

		const { marzbanUsername } = subscription;
		const remote = await this.marzban.getUser(marzbanUsername);

		/**
		 * A subscription whose panel user vanished is an operator problem, not a drift this job can
		 * close: recreating the user here would need the plan's traffic limit and would quietly paper
		 * over whatever deleted it. Throwing routes it to the admin alert, which is the point of
		 * running a reconcile at all.
		 */
		if (!remote) {
			this.log.error('marzban_reconcile_user_missing', {
				subscriptionId: subscription.id,
				username: marzbanUsername
			});
			throw new Error(
				`marzban user ${marzbanUsername} is missing for subscription ${subscription.id}`
			);
		}

		const expiresAtMs = subscription.expiresAt.getTime();
		// Milliseconds on both sides of this comparison: the seconds Marzban speaks are converted
		// inside clients/marzban/http.ts and nowhere else (CLAUDE.md 4).
		const expiryDrifted = remote.expiresAtMs !== expiresAtMs;

		if (expiryDrifted) {
			await this.marzban.setExpiry(marzbanUsername, expiresAtMs);
		}

		/**
		 * Only `active` and `disabled` are ours to set (clients/marzban/types.ts). The panel's other
		 * statuses — `limited`, `expired`, `on_hold` — are Marzban's own conclusions, and the one that
		 * matters here resolves itself: a user it marked `expired` under a stale date becomes active
		 * again once the corrected expiry lands above. So the desired status is read from our date,
		 * and anything the panel says that is not already that is corrected.
		 */
		const desired = isActiveAt(expiresAtMs, this.now()) ? 'active' : 'disabled';
		const statusDrifted = remote.status !== desired;

		if (statusDrifted) {
			await this.marzban.setStatus(marzbanUsername, desired);
		}

		this.log.info('marzban_reconciled', {
			subscriptionId: subscription.id,
			expiryDrifted,
			statusDrifted
		});
	}
}
