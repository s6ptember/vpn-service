import * as v from 'valibot';
import type { JobMap, JobType } from '$lib/types';
import type { JobRow } from '$lib/server/db/schema';
import type { Logger } from '$lib/server/log';
import type { JobHandler } from './handler';
import type { JobQueue } from './queue';

/** tech.md 6: one process, one worker, a tick every 2 seconds. */
const DEFAULT_INTERVAL_MS = 2_000;

/**
 * A tick drains every due job, but not without end: a queue that refills faster than it drains
 * would starve the event loop and never let stop() land.
 */
const MAX_JOBS_PER_TICK = 50;

/** Alerts are jobs too, so they are recognised by their key and never alert about themselves. */
const ALERT_KEY_PREFIX = 'tg:job-failed:';

export interface JobWorkerOptions {
	/** Injected, never read from config here: the worker must stay constructible in a test. */
	adminChatId: number;
	intervalMs?: number;
}

export class JobWorker {
	private readonly handlers: ReadonlyMap<string, JobHandler<JobType>>;
	private readonly intervalMs: number;
	private readonly adminChatId: number;
	private timer: ReturnType<typeof setInterval> | null = null;
	private ticking = false;

	constructor(
		private readonly queue: JobQueue,
		handlers: JobHandler<JobType>[],
		private readonly log: Logger,
		opts: JobWorkerOptions
	) {
		const registry = new Map<string, JobHandler<JobType>>();
		for (const handler of handlers) {
			// Two handlers for one type means one of them silently never runs. Fail at wiring time.
			if (registry.has(handler.type)) {
				throw new Error(`duplicate job handler for type ${handler.type}`);
			}
			registry.set(handler.type, handler);
		}

		this.handlers = registry;
		this.adminChatId = opts.adminChatId;
		this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
	}

	start(): void {
		if (this.timer) return;

		this.recoverOrphans();

		this.timer = setInterval(() => void this.tick(), this.intervalMs);
		// The worker must not be the reason the process refuses to exit.
		this.timer.unref();
	}

	/**
	 * tech.md 3 pins the deployment to exactly one replica and tech.md 6 to one worker inside it.
	 * So a row still `running` at the moment this worker starts cannot belong to anybody: it was
	 * claimed by a process that then died — a deploy, an OOM kill, a host reboot. claim() reads
	 * only `pending` rows, so without this the job is stranded forever and a paid-for subscription
	 * is never provisioned, silently.
	 *
	 * Recovery goes through the ordinary failure path rather than flipping the row straight back to
	 * pending. That costs the orphan the attempt it had already burned, which is the point: a job
	 * that kills the process must run out of attempts and alert the admin instead of crash-looping
	 * the container. The backoff buys the same protection on the time axis.
	 */
	private recoverOrphans(): void {
		for (const job of this.queue.findRunning()) {
			this.log.warn('jobs.orphan_recovered', {
				jobId: job.id,
				type: job.type,
				attempts: job.attempts
			});

			this.fail(job, new Error('worker restarted while the job was running'), false);
		}
	}

	stop(): void {
		if (!this.timer) return;

		clearInterval(this.timer);
		this.timer = null;
	}

	/**
	 * Drains the due jobs. It never throws: setInterval has nobody to catch for it, and an
	 * unhandled rejection here would take the whole process down over one bad row.
	 */
	async tick(): Promise<void> {
		// setInterval does not wait for the previous tick. Overlapping drains would fight for the
		// write lock and lengthen every claim.
		if (this.ticking) return;
		this.ticking = true;

		try {
			for (let i = 0; i < MAX_JOBS_PER_TICK; i++) {
				const job = this.queue.claim();
				if (!job) break;

				await this.run(job);
			}
		} catch (error) {
			// The logger redacts and structures the throw; nothing here needs to pre-format it.
			this.log.error('jobs.tick_failed', { error });
		} finally {
			this.ticking = false;
		}
	}

	private async run(job: JobRow): Promise<void> {
		const handler = this.handlers.get(job.type);

		// An unknown type never becomes runnable by waiting: retrying it is a five-attempt no-op.
		if (!handler) {
			this.fail(job, new Error(`unknown job type: ${job.type}`), true);
			return;
		}

		// Terminality is decided by WHERE the throw came from, never by what it is. Parsing sits in
		// its own try for that reason: handlers validate upstream responses with valibot too, so
		// keying off `isValiError` would let one malformed Marzban body kill a job that a retry
		// would have saved.
		let payload: JobMap[JobType];
		try {
			payload = v.parse(handler.schema, job.payload);
		} catch (error) {
			// A payload that does not match the schema will not match it on the sixth attempt either.
			this.fail(job, error, true);
			return;
		}

		try {
			await handler.handle(payload);
			this.queue.complete(job.id);
		} catch (error) {
			this.fail(job, error, false);
		}
	}

	private fail(job: JobRow, error: unknown, terminal: boolean): void {
		this.queue.fail(job.id, error, { terminal });

		const failed = this.queue.find(job.id);
		if (failed?.status !== 'failed') return;

		this.log.error('jobs.job_failed', {
			jobId: job.id,
			type: job.type,
			attempts: failed.attempts,
			error: failed.lastError
		});

		this.alertAdmin(failed);
	}

	/** tech.md 6: a terminal job alerts the admin. */
	private alertAdmin(job: JobRow): void {
		// An alert that fails would alert about its own failure, forever. The loop stops here.
		if (job.idempotencyKey.startsWith(ALERT_KEY_PREFIX)) return;

		const dedupeKey = `job-failed:${job.id}`;

		this.queue.enqueue(
			'telegram.send_message',
			{
				chatId: this.adminChatId,
				text: `Джоб ${job.type} #${job.id} упал после ${job.attempts} попыток. Причина: ${job.lastError ?? 'неизвестна'}`,
				dedupeKey
			},
			`tg:${dedupeKey}`
		);
	}
}
