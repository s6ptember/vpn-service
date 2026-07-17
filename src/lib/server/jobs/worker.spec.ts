import { beforeEach, describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { eq } from 'drizzle-orm';
import { FakeTelegram } from '$lib/server/clients/telegram';
import type { Db } from '$lib/server/db/client';
import { jobs } from '$lib/server/db/schema';
import { createTestDb, silentLogger, TestClock } from './fixtures';
import { JobHandler } from './handler';
import { TelegramSendMessageHandler } from './handlers/telegram-send-message';
import { JobQueue } from './queue';
import { JobWorker } from './worker';

const ADMIN_CHAT_ID = 111;
const USER_CHAT_ID = 42;

describe('JobWorker', () => {
	let db: Db;
	let clock: TestClock;
	let queue: JobQueue;
	let telegram: FakeTelegram;
	let worker: JobWorker;

	beforeEach(() => {
		db = createTestDb();
		clock = new TestClock();
		queue = new JobQueue(db, clock.now);
		telegram = new FakeTelegram();
		worker = new JobWorker(
			queue,
			[new TelegramSendMessageHandler(telegram, silentLogger())],
			silentLogger(),
			{ adminChatId: ADMIN_CHAT_ID }
		);
	});

	const row = (id: number) => db.select().from(jobs).where(eq(jobs.id, id)).get();
	const rows = () => db.select().from(jobs).all();

	const sendWelcome = (dedupeKey = 'welcome:7') =>
		queue.enqueue(
			'telegram.send_message',
			{ chatId: USER_CHAT_ID, text: 'Подписка активна', dedupeKey },
			`tg:${dedupeKey}`
		);

	it('runs a due job and marks it done', async () => {
		sendWelcome();

		await worker.tick();

		expect(telegram.sent).toEqual([
			{ chatId: USER_CHAT_ID, text: 'Подписка активна', options: undefined }
		]);
		expect(row(1)).toMatchObject({ status: 'done', attempts: 1, lastError: null });
	});

	it('sends one message for one logical message, whatever the enqueue and tick count', async () => {
		// tech.md 6/14: the same payload twice must produce exactly one effect. The queue key is the
		// barrier; two ticks then find nothing left to claim.
		sendWelcome();
		sendWelcome();

		await worker.tick();
		await worker.tick();

		expect(telegram.sent).toHaveLength(1);
		expect(rows()).toHaveLength(1);
	});

	it('drains every due job in one tick', async () => {
		sendWelcome('a');
		sendWelcome('b');
		sendWelcome('c');

		await worker.tick();

		expect(telegram.sent).toHaveLength(3);
	});

	it('retries a 500 with the tech.md 6 backoff instead of failing the job', async () => {
		sendWelcome();
		telegram.failNext(500);
		const failedAt = clock.now();

		await worker.tick();

		expect(telegram.sent).toHaveLength(0);
		expect(row(1)).toMatchObject({
			status: 'pending',
			attempts: 1,
			lockedAt: null,
			// 2^1 * 30s, transcribed from tech.md 6.
			runAt: new Date(failedAt + 60_000)
		});
		expect(row(1)!.lastError).toContain('Internal Server Error');
	});

	it('delivers the message on the retry after a transient failure', async () => {
		sendWelcome();
		telegram.failNext(500);

		await worker.tick();
		clock.advance(60_000);
		await worker.tick();

		expect(telegram.sent).toHaveLength(1);
		expect(row(1)).toMatchObject({ status: 'done', attempts: 2, lastError: null });
	});

	it('retries a 429 with retry_after rather than marking it failed', async () => {
		sendWelcome();
		telegram.failNext(429);

		await worker.tick();

		// Rate limiting is the most transient failure there is: it must never burn a job.
		expect(row(1)).toMatchObject({ status: 'pending', attempts: 1 });
		expect(row(1)!.lastError).toContain('Too Many Requests');
	});

	it('retries a timeout rather than marking it failed', async () => {
		sendWelcome();
		telegram.failNext('timeout');

		await worker.tick();

		expect(row(1)).toMatchObject({ status: 'pending', attempts: 1 });
	});

	it('marks the job failed with lastError once attempts run out and alerts the admin once', async () => {
		queue.enqueue(
			'telegram.send_message',
			{ chatId: USER_CHAT_ID, text: 'Подписка активна', dedupeKey: 'doomed' },
			'tg:doomed',
			{ maxAttempts: 1 }
		);
		telegram.failNext(500);

		await worker.tick();

		// tech.md 6: after maxAttempts the job is terminal and the admin hears about it.
		expect(row(1)).toMatchObject({ status: 'failed', attempts: 1 });
		expect(row(1)!.lastError).toContain('Internal Server Error');

		const alerts = rows().filter((job) => job.idempotencyKey === 'tg:job-failed:1');
		expect(alerts).toHaveLength(1);
		expect(alerts[0]).toMatchObject({ type: 'telegram.send_message' });

		// The alert is a job like any other, so the same tick already delivered it.
		expect(telegram.sent).toEqual([
			{ chatId: ADMIN_CHAT_ID, text: expect.stringContaining('#1'), options: undefined }
		]);
	});

	it('alerts the admin once even if the failed job is retried into the ground', async () => {
		queue.enqueue(
			'telegram.send_message',
			{ chatId: USER_CHAT_ID, text: 'Подписка активна', dedupeKey: 'doomed' },
			'tg:doomed',
			{ maxAttempts: 2 }
		);

		telegram.failNext(500);
		await worker.tick();
		clock.advance(60_000);
		telegram.failNext(500);
		await worker.tick();

		expect(row(1)).toMatchObject({ status: 'failed', attempts: 2 });
		expect(rows().filter((job) => job.idempotencyKey.startsWith('tg:job-failed:'))).toHaveLength(1);
	});

	it('never alerts about a failed alert', async () => {
		queue.enqueue(
			'telegram.send_message',
			{ chatId: ADMIN_CHAT_ID, text: 'Джоб упал', dedupeKey: 'job-failed:99' },
			'tg:job-failed:99',
			{ maxAttempts: 1 }
		);
		telegram.failNext(500);

		await worker.tick();

		// Alerting about a broken alert would enqueue an alert about that alert, forever.
		expect(row(1)).toMatchObject({ status: 'failed' });
		expect(rows()).toHaveLength(1);
	});

	it('fails an unknown job type terminally instead of retrying it', async () => {
		db.insert(jobs)
			.values({
				type: 'subscription.provision',
				payload: { orderId: 1 },
				idempotencyKey: 'provision:order:1',
				status: 'pending',
				attempts: 0,
				maxAttempts: 5,
				runAt: new Date(clock.now()),
				createdAt: new Date(clock.now()),
				updatedAt: new Date(clock.now())
			})
			.run();

		await worker.tick();

		// No handler is registered for it yet: waiting will not conjure one.
		expect(row(1)).toMatchObject({ status: 'failed', attempts: 1 });
		expect(row(1)!.lastError).toContain('unknown job type');
	});

	it('fails a payload that does not match the schema terminally', async () => {
		db.insert(jobs)
			.values({
				type: 'telegram.send_message',
				payload: { chatId: 'not-a-number', text: '', dedupeKey: 'broken' },
				idempotencyKey: 'tg:broken',
				status: 'pending',
				attempts: 0,
				maxAttempts: 5,
				runAt: new Date(clock.now()),
				createdAt: new Date(clock.now()),
				updatedAt: new Date(clock.now())
			})
			.run();

		await worker.tick();

		// Unparsed data must never reach a handler, and it will not parse on the fifth attempt either.
		expect(row(1)).toMatchObject({ status: 'failed', attempts: 1 });
		// Only the admin alert goes out; the broken payload never reaches the Bot API.
		expect(telegram.sent.map((sent) => sent.chatId)).toEqual([ADMIN_CHAT_ID]);
	});

	it('retries a handler that throws a valibot error of its own instead of killing the job', async () => {
		// The payload here is valid. The throw comes from the handler validating an upstream
		// response, which every real handler will do. Terminality must follow from an unparsable
		// PAYLOAD, not from the class of the throw, or one bad Marzban body burns a paid order.
		class ReconcileHandler extends JobHandler<'marzban.reconcile'> {
			readonly type = 'marzban.reconcile';
			readonly schema = v.object({ subscriptionId: v.number() });

			async handle(): Promise<void> {
				v.parse(v.object({ expire: v.number() }), { expire: null });
			}
		}

		const reconciler = new JobWorker(queue, [new ReconcileHandler()], silentLogger(), {
			adminChatId: ADMIN_CHAT_ID
		});
		queue.enqueue('marzban.reconcile', { subscriptionId: 1 }, 'reconcile:1:0');

		await reconciler.tick();

		expect(row(1)).toMatchObject({ status: 'pending', attempts: 1 });
	});

	it('recovers a job left running by a process that died', async () => {
		sendWelcome();

		// The previous worker claimed it; the container was killed before it could finish.
		queue.claim();
		expect(row(1)).toMatchObject({ status: 'running' });

		// A new process boots. tech.md 3 allows exactly one replica, so nobody else holds this row.
		worker.start();
		worker.stop();

		expect(row(1)).toMatchObject({ status: 'pending', attempts: 1, lockedAt: null });

		clock.advance(60_000);
		await worker.tick();

		// Without recovery the message is never sent and nobody is ever told.
		expect(telegram.sent).toHaveLength(1);
		expect(row(1)).toMatchObject({ status: 'done', attempts: 2 });
	});

	it('gives up on an orphan that has already burned its attempts and alerts the admin', async () => {
		queue.enqueue(
			'telegram.send_message',
			{ chatId: USER_CHAT_ID, text: 'Подписка активна', dedupeKey: 'doomed' },
			'tg:doomed',
			{ maxAttempts: 1 }
		);
		queue.claim();

		worker.start();
		worker.stop();

		// A job that kills the process must run out of attempts, not crash-loop the container.
		expect(row(1)).toMatchObject({ status: 'failed', attempts: 1 });
		expect(rows().filter((job) => job.idempotencyKey === 'tg:job-failed:1')).toHaveLength(1);
	});

	it('leaves nothing to recover on a clean start', async () => {
		sendWelcome();
		await worker.tick();

		worker.start();
		worker.stop();

		// A done job must not be resurrected by a restart.
		expect(row(1)).toMatchObject({ status: 'done', attempts: 1 });
		expect(telegram.sent).toHaveLength(1);
	});

	it('survives a tick with nothing to do', async () => {
		await expect(worker.tick()).resolves.toBeUndefined();
	});

	it('rejects two handlers for one job type at wiring time', () => {
		expect(
			() =>
				new JobWorker(
					queue,
					[
						new TelegramSendMessageHandler(telegram, silentLogger()),
						new TelegramSendMessageHandler(telegram, silentLogger())
					],
					silentLogger(),
					{ adminChatId: ADMIN_CHAT_ID }
				)
		).toThrow(/duplicate job handler/);
	});
});
