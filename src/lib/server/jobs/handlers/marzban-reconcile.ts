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
		 * Whether our record says this person is owed access at all.
		 *
		 * The status column is read as well as the date, and that is load-bearing: `revoked` is a
		 * decision somebody made, and a revoked subscription can still hold a future `expiresAt` —
		 * revoking does not rewrite the date. Deciding from the date alone would hand access back to
		 * exactly the person it was taken from, which is the one outcome this job must never produce.
		 */
		const owedAccess = subscription.status === 'active' && isActiveAt(expiresAtMs, this.now());

		/**
		 * Only `active` and `disabled` are ours to set (clients/marzban/types.ts), and of Marzban's
		 * five statuses only `active` actually lets somebody connect. So the correction is asymmetric
		 * rather than a straight comparison against a desired value:
		 *
		 *   - owed access, panel says `disabled` or `expired` → switch it on. Both are conclusions
		 *     drawn from something we own — an admin toggle, or a stale date the write above has just
		 *     corrected — so ours is the later word.
		 *   - owed no access, panel says `active` → switch it off.
		 *   - anything else → leave it alone. `limited` and `on_hold` are Marzban's own conclusions,
		 *     drawn from the traffic quota and from a start date we do not model. Flipping `limited`
		 *     to `active` would hand back an allowance the panel had already spent, and this job has
		 *     no business overruling a quota it does not track.
		 */
		const grantsAccess = remote.status === 'active';
		const correctable = remote.status === 'disabled' || remote.status === 'expired';

		let statusDrifted = false;

		if (owedAccess && correctable) {
			await this.marzban.setStatus(marzbanUsername, 'active');
			statusDrifted = true;
		} else if (!owedAccess && grantsAccess) {
			await this.marzban.setStatus(marzbanUsername, 'disabled');
			statusDrifted = true;
		}

		this.log.info('marzban_reconciled', {
			subscriptionId: subscription.id,
			expiryDrifted,
			statusDrifted
		});
	}
}
