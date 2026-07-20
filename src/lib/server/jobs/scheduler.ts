import type { JobQueue } from './queue';

/**
 * tech.md 6: the sweep runs every five minutes, and the idempotency key is the window it belongs to.
 */
export const SWEEP_WINDOW_MS = 300_000;

/**
 * The scheduler ticks faster than the window it schedules. A tick equal to the window would mean a
 * container that restarts just after one lands waits a full window before the next — and the tick
 * that would have covered it is the one the restart ate. At this rate every window is offered
 * several times and the unique key throws all but the first away.
 */
const DEFAULT_INTERVAL_MS = 30_000;

export interface JobSchedulerOptions {
	now?: () => number;
	intervalMs?: number;
}

/**
 * Puts the recurring jobs on the queue (A15). tech.md 6 gives `subscription.sweep` a planner and no
 * other job one, so this class knows about exactly that job.
 *
 * ## Why a key derived from the clock, and not a "last run" row
 *
 * The key is `sweep:<floor(now / 300000)>` — the number of the five-minute window, not a timestamp.
 * That is the whole deduplication mechanism, and tech.md 6 spells out why it has to be: "Рестарт
 * контейнера внутри окна дубля не создаст." A restart at any point inside a window recomputes the
 * same number, the insert loses on the unique index, and nothing happens. A ledger row recording the
 * last run would need its own write, its own transaction against the tick that is already running,
 * and would still be wrong the first time somebody restored a backup.
 *
 * Windows are skipped rather than caught up when the process was down: `floor(now / window)` names
 * only the window we are in. That is correct for a sweep, which is convergent — one run over a
 * lapsed subscription does what ten would (subscriptions/subscription-service.ts, expireLapsed).
 */
export class JobScheduler {
	private readonly now: () => number;
	private readonly intervalMs: number;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly queue: JobQueue,
		opts: JobSchedulerOptions = {}
	) {
		this.now = opts.now ?? Date.now;
		this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
	}

	/** Idempotent, like JobWorker.start: a second call must not leave a second timer running. */
	start(): void {
		if (this.timer) return;

		// The window the process starts in is due immediately — waiting one interval for the first
		// tick would leave a just-deployed container sweeping nothing for half a minute.
		this.enqueueDue();

		this.timer = setInterval(() => this.enqueueDue(), this.intervalMs);
		// The scheduler must not be the reason the process refuses to exit.
		this.timer.unref();
	}

	stop(): void {
		if (!this.timer) return;

		clearInterval(this.timer);
		this.timer = null;
	}

	/**
	 * Offers the current window to the queue. Public so a spec drives it directly, the way
	 * JobWorker.tick is — a test that had to wait for a timer would be a test about setInterval.
	 *
	 * enqueue swallows a duplicate on the unique index, so calling this on every tick is free.
	 */
	enqueueDue(): void {
		const window = Math.floor(this.now() / SWEEP_WINDOW_MS);

		this.queue.enqueue('subscription.sweep', {}, `sweep:${window}`);
	}
}
