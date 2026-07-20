import * as v from 'valibot';
import type { Logger } from '$lib/server/log';
import { DAY_MS, daysLeft, type SubscriptionService } from '$lib/server/subscriptions';
import { JobHandler } from '../handler';
import type { JobQueue } from '../queue';

/** tech.md 6 gives this job an empty payload: what it does depends on the clock, not on arguments. */
const PayloadSchema = v.object({});

/**
 * The two marks tech.md 6 asks for. Ordered so the widest is first — it is also the window read.
 */
const NOTIFY_AT_DAYS = [3, 1] as const;

/** How far ahead to look. The widest mark, so one query feeds every warning below it. */
const LOOKAHEAD_MS = NOTIFY_AT_DAYS[0] * DAY_MS;

export interface SubscriptionSweepOptions {
	/** Injected, never read from a module here: the handler must stay constructible in a test. */
	now?: () => number;
}

/**
 * Closes the subscriptions whose term ran out and warns the people whose term is about to (A15).
 *
 * ## Idempotency
 *
 * tech.md 6 requires two runs of the same payload to leave exactly one effect, and this job is
 * genuinely run more than once per window: the scheduler offers it on every tick, a failed attempt
 * is retried, and the worker re-runs a job that a dying process left `running` (jobs/worker.ts,
 * recoverOrphans).
 *
 * Neither half needs a guard, because neither half accumulates:
 *
 *   - `expireLapsed` matches only rows that are still `active`, so the second run over the same
 *     lapsed subscription matches nothing (subscriptions/subscription-service.ts).
 *   - the warnings are enqueued under `expiry:<subscriptionId>:<daysLeft>`, a key that is a pure
 *     function of the row and the mark. The second run recomputes the same key and the unique index
 *     drops it (tech.md 6).
 *
 * So the effect is convergent rather than merely deduplicated: it does not matter whether the job
 * runs once or forty times in a window, only that it runs.
 *
 * ## Why no Marzban call
 *
 * Expiry is already enforced by the panel — `expire` was written at provision time — so a lapsed
 * subscription has already lost access without anybody telling it to. This job records that fact
 * locally. Pushing state to Marzban is `marzban.reconcile`'s work (A16), and doing it here would put
 * one network call per lapsed row inside a job whose whole value is that it cannot half-fail.
 */
export class SubscriptionSweepHandler extends JobHandler<'subscription.sweep'> {
	readonly type = 'subscription.sweep';
	readonly schema = PayloadSchema;

	private readonly now: () => number;

	constructor(
		private readonly subscriptions: SubscriptionService,
		private readonly jobs: JobQueue,
		private readonly log: Logger,
		opts: SubscriptionSweepOptions = {}
	) {
		super();
		this.now = opts.now ?? Date.now;
	}

	async handle(): Promise<void> {
		const now = this.now();

		const { expiredIds } = this.subscriptions.expireLapsed(now);

		for (const subscriptionId of expiredIds) {
			// Ids only: whose subscription it is and what they bought are not this log line's business.
			this.log.info('subscription_expired', { subscriptionId });
		}

		for (const row of this.subscriptions.listExpiringWithin(now, LOOKAHEAD_MS)) {
			const left = daysLeft(row.expiresAt.getTime(), now);

			/**
			 * Exactly 3 or exactly 1 (tech.md 6). `daysLeft` rounds up, so each subscription passes
			 * through both marks on its way down and a sweep on the day between them warns nobody —
			 * which is the point: the marks are the contract, not "warn while it is nearly over".
			 *
			 * The one shared implementation from expiry.ts, deliberately (CLAUDE.md 4): if this job
			 * counted days its own way, the profile screen would show "2 дня" on the morning somebody
			 * got told they had 3 left.
			 */
			if (!isNotifyMark(left)) continue;

			/**
			 * The key is transcribed from tech.md 6 exactly: `expiry:<subscriptionId>:<daysLeft>`.
			 *
			 * CONTRACT GAP
			 * Нужно: компонент срока в ключе `subscription.notify_expiry`.
			 * Зачем: A15. Продлившийся человек больше никогда не получит предупреждение.
			 * Предлагаемая форма: `expiry:<subscriptionId>:<expiresAtMs>:<daysLeft>` в tech.md 6.
			 *
			 * A subscription keeps its id across renewals — `SubscriptionService.upsert` writes one row
			 * per person and overwrites it — so the second term recomputes the key the first term
			 * already spent, the unique index drops it, and nobody is warned again. Nothing purges the
			 * jobs table, so it is permanent. Every other recurring key in tech.md 6 carries a time
			 * component (`sweep:<window>`, `reconcile:<id>:<hour>`); this one is the exception, which
			 * reads like an oversight rather than a decision.
			 *
			 * Left exactly as specified regardless: inventing a key shape is the one thing CLAUDE.md 0
			 * forbids outright, and a key the lead has not seen would be worse than a warning nobody
			 * gets. The issue is open; this comment goes when it lands.
			 */
			this.jobs.enqueue(
				'subscription.notify_expiry',
				{ subscriptionId: row.id, daysLeft: left },
				`expiry:${row.id}:${left}`
			);
		}
	}
}

/** Narrows to the literal union JobMap wants, so the mark list stays the single source of it. */
function isNotifyMark(days: number): days is (typeof NOTIFY_AT_DAYS)[number] {
	return (NOTIFY_AT_DAYS as readonly number[]).includes(days);
}
