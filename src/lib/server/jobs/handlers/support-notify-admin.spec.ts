import { beforeEach, describe, expect, it } from 'vitest';
import { UserService } from '$lib/server/auth/user-service';
import { addUser } from '$lib/server/billing/fixtures';
import { FakeTelegram, MAX_MESSAGE_LENGTH } from '$lib/server/clients/telegram';
import type { Db } from '$lib/server/db/client';
import { TICKET_MESSAGE_MAX } from '$lib/types';
import { SupportTicketService } from '$lib/server/support';
import { createTestDb, silentLogger, TestClock } from '../fixtures';
import { JobQueue } from '../queue';
import { JobWorker } from '../worker';
import { SupportNotifyAdminHandler } from './support-notify-admin';

/**
 * A14's acceptance criteria (tech.md 6 and 16): a ticket reaches ADMIN_CHAT_ID's private chat and
 * the id of that message is written back on the ticket.
 *
 * Over them sits tech.md 6's flat requirement — two runs of the same payload leave exactly one
 * effect. It is not decoration here: the worker deliberately re-runs a job that a dying process
 * left `running`, so a handler without a guard would show the admin the same request again on every
 * deploy that landed mid-job.
 */

const ADMIN_CHAT_ID = 900_000_001;
const MESSAGE = 'VPN не подключается на iPhone, приложение V2Box. Ключ импортировал вчера.';

let db: Db;
let clock: TestClock;
let queue: JobQueue;
let tickets: SupportTicketService;
let telegram: FakeTelegram;
let handler: SupportNotifyAdminHandler;
let userId: number;

/** The state the form action leaves behind: one ticket, one pending job. */
function fileTicket(message = MESSAGE): number {
	const created = tickets.create({ userId, message });
	if (!created.ok) throw new Error('the fixture must not hit the rate limit');
	return created.value.id;
}

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock();
	queue = new JobQueue(db, clock.now);
	tickets = new SupportTicketService(db, queue, { now: clock.now });
	telegram = new FakeTelegram();
	userId = addUser(db).id;

	handler = new SupportNotifyAdminHandler(tickets, new UserService(db), telegram, silentLogger(), {
		adminChatId: ADMIN_CHAT_ID
	});
});

describe('SupportNotifyAdminHandler', () => {
	it('relays the request to the admin and writes the message id back', async () => {
		const ticketId = fileTicket();

		await handler.handle({ ticketId });

		expect(telegram.sent).toHaveLength(1);
		expect(telegram.sent[0].chatId).toBe(ADMIN_CHAT_ID);
		expect(telegram.sent[0].text).toContain(MESSAGE);

		const ticket = tickets.findById(ticketId)!;
		expect(ticket.status).toBe('delivered');
		expect(ticket.adminMessageId).toBe(1);
		expect(ticket.deliveredAt?.getTime()).toBe(clock.now());
	});

	/**
	 * The message is typed by a stranger. Sent as plain text it can say anything; under HTML or
	 * MarkdownV2 a stray '<' would turn every such request into a 400 from Bot API.
	 */
	it('sends the request as plain text, with no parse mode', async () => {
		const ticketId = fileTicket('Не работает <b>ничего</b> — что делать? *(iOS 18)*');

		await handler.handle({ ticketId });

		expect(telegram.sent[0].options?.parse_mode).toBeUndefined();
		expect(telegram.sent[0].text).toContain('<b>ничего</b>');
	});

	it('names the ticket and its author so the admin can answer', async () => {
		const ticketId = fileTicket();

		await handler.handle({ ticketId });

		const { text } = telegram.sent[0];
		expect(text).toContain(`#${ticketId}`);
		expect(text).toContain('Александр Ким');
		expect(text).toContain('@alex_k');
	});

	/** Bot API caps a message at 4096. The header is measured, not budgeted for, so this holds
	 *  even for a person whose Telegram profile is as long as Telegram allows. */
	it('stays inside the Bot API length cap on the longest message anybody can send', async () => {
		const long = addUser(db, {
			telegramId: 700_000_999,
			firstName: 'И'.repeat(64),
			lastName: 'К'.repeat(64),
			username: 'u'.repeat(32)
		});
		const created = tickets.create({ userId: long.id, message: 'я'.repeat(TICKET_MESSAGE_MAX) });
		if (!created.ok) throw new Error('the fixture must not hit the rate limit');

		await handler.handle({ ticketId: created.value.id });

		expect(telegram.sent[0].text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
	});

	// --- idempotency (tech.md 6) ---------------------------------------------------------------

	it('shows the admin one request however many times it runs', async () => {
		const ticketId = fileTicket();

		await handler.handle({ ticketId });
		await handler.handle({ ticketId });
		await handler.handle({ ticketId });

		expect(telegram.sent).toHaveLength(1);
		expect(tickets.findById(ticketId)?.adminMessageId).toBe(1);
	});

	/**
	 * The path that makes the guard necessary rather than theoretical: a process died mid-job, the
	 * row is still `running`, and the worker re-runs it on the next start (jobs/worker.ts).
	 */
	it('survives a worker that restarts on top of a job it already finished', async () => {
		const ticketId = fileTicket();
		await handler.handle({ ticketId });

		const claimed = queue.claim()!;
		expect(claimed.type).toBe('support.notify_admin');
		// Left `running` by the process that died. recoverOrphans fails it back to pending...
		const worker = new JobWorker(queue, [handler], silentLogger(), { adminChatId: ADMIN_CHAT_ID });
		worker.start();
		worker.stop();

		clock.advance(60 * 60_000);
		await worker.tick();

		// The re-run really happened — the job is finished, not merely left where it was.
		expect(queue.find(claimed.id)?.status).toBe('done');
		expect(telegram.sent).toHaveLength(1);
	});

	// --- the error path (tech.md 14) ------------------------------------------------------------

	it.each(['timeout', 500, 429] as const)(
		'records the failed attempt and rethrows when Telegram answers %s',
		async (mode) => {
			const ticketId = fileTicket();
			telegram.failNext(mode);

			await expect(handler.handle({ ticketId })).rejects.toThrow();

			const ticket = tickets.findById(ticketId)!;
			// Not `new`: the row says what happened to the latest attempt rather than pretending
			// nothing has been tried yet.
			expect(ticket.status).toBe('failed');
			expect(ticket.adminMessageId).toBeNull();
			expect(telegram.sent).toHaveLength(0);
		}
	);

	/** The queue owns the retry, so the next attempt has to be able to finish the job. */
	it('delivers on the retry after a failure, and says so on the ticket', async () => {
		const ticketId = fileTicket();
		telegram.failNext(500);
		await expect(handler.handle({ ticketId })).rejects.toThrow();

		await handler.handle({ ticketId });

		expect(telegram.sent).toHaveLength(1);
		const ticket = tickets.findById(ticketId)!;
		expect(ticket.status).toBe('delivered');
		expect(ticket.adminMessageId).toBe(1);
	});

	it('throws on a ticket that does not exist rather than reporting success', async () => {
		await expect(handler.handle({ ticketId: 4242 })).rejects.toThrow(/4242/);
		expect(telegram.sent).toHaveLength(0);
	});
});
