import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { addUser } from '$lib/server/billing/fixtures';
import type { Db } from '$lib/server/db/client';
import { jobs as jobsTable, supportTickets, type UserRow } from '$lib/server/db/schema';
import { createTestDb, TestClock } from '$lib/server/jobs/fixtures';
import { JobQueue } from '$lib/server/jobs/queue';
import { SupportTicketService, TICKET_LIMIT, TICKET_WINDOW_MS } from './ticket-service';

/**
 * A14's acceptance criteria (tech.md 16, 11 and CLAUDE.md 2): a request becomes a row, the row
 * hands the queue a `support.notify_admin` job, and nobody sends more than three an hour.
 *
 * The tests are written against those sentences rather than against the implementation: they never
 * ask which mechanism counts the attempts, only that the fourth one inside the hour is refused, that
 * the wait quoted is the real one, and that a refusal writes nothing at all.
 */

const HOUR = TICKET_WINDOW_MS;

let db: Db;
let clock: TestClock;
let queue: JobQueue;
let service: SupportTicketService;
let user: UserRow;
let other: UserRow;

const write = (message = 'Не подключается на iPhone, приложение V2Box.') =>
	service.create({ userId: user.id, message });

const ticketRows = () => db.select().from(supportTickets).all();
const jobRows = () => db.select().from(jobsTable).all();

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock();
	queue = new JobQueue(db, clock.now);
	service = new SupportTicketService(db, queue, { now: clock.now });
	user = addUser(db);
	other = addUser(db, { telegramId: 700_000_222, username: 'mariia' });
});

describe('SupportTicketService.create', () => {
	/**
	 * Every test below counts in units of TICKET_LIMIT, which keeps them readable and leaves the
	 * number itself unpinned — the suite would stay green at a limit of one while the sentence the
	 * person reads still said three. CLAUDE.md 2 fixes it at three, so it is asserted once, here.
	 */
	it('allows three an hour, the number CLAUDE.md 2 sets', () => {
		expect(TICKET_LIMIT).toBe(3);
	});

	it('writes the request as a new ticket owned by the person who sent it', () => {
		const created = write('Ключ не импортируется в Hiddify.');

		expect(created.ok).toBe(true);
		expect(ticketRows()).toEqual([
			expect.objectContaining({
				userId: user.id,
				message: 'Ключ не импортируется в Hiddify.',
				status: 'new',
				adminMessageId: null,
				deliveredAt: null
			})
		]);
	});

	/**
	 * tech.md 6 keys the job on `ticket:<ticketId>`, and the two rows are written together on
	 * purpose: a ticket with no job is a request nobody is ever told about.
	 */
	it('queues the relay for exactly that ticket', () => {
		const created = write();
		const ticketId = created.ok ? created.value.id : 0;

		expect(jobRows()).toEqual([
			expect.objectContaining({
				type: 'support.notify_admin',
				payload: { ticketId },
				idempotencyKey: `ticket:${ticketId}`,
				status: 'pending'
			})
		]);
	});

	it('takes three requests inside one hour', () => {
		for (let i = 0; i < TICKET_LIMIT; i++) {
			clock.advance(60_000);
			expect(write().ok).toBe(true);
		}

		expect(ticketRows()).toHaveLength(TICKET_LIMIT);
	});

	it('refuses the fourth and writes nothing at all', () => {
		for (let i = 0; i < TICKET_LIMIT; i++) write();

		const refused = write();

		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.error.reason).toBe('rate_limited');
		// Neither half of the pair: a refused request must not reach the admin's Telegram either.
		expect(ticketRows()).toHaveLength(TICKET_LIMIT);
		expect(jobRows()).toHaveLength(TICKET_LIMIT);
	});

	/**
	 * The window rolls: the budget frees up as the oldest counted request ages out, not on some
	 * shared hourly boundary. So the wait quoted has to be the real one — somebody told to come back
	 * in twenty minutes must actually be served in twenty minutes.
	 */
	it('quotes the wait until the oldest of the counted requests ages out', () => {
		write();
		clock.advance(20 * 60_000);
		write();
		write();

		const refused = write();

		expect(refused.ok).toBe(false);
		// The first one was 20 minutes ago, so 40 minutes of its hour remain.
		if (!refused.ok) expect(refused.error.retryAfterSec).toBe(40 * 60);
	});

	it('lets the person through again once that request has aged out', () => {
		for (let i = 0; i < TICKET_LIMIT; i++) write();
		expect(write().ok).toBe(false);

		clock.advance(HOUR + 1000);

		expect(write().ok).toBe(true);
	});

	/** The limit is per person. One noisy account must not close the door on anybody else. */
	it('counts each person separately', () => {
		for (let i = 0; i < TICKET_LIMIT; i++) write();

		expect(service.create({ userId: other.id, message: 'У меня тоже не работает VPN.' }).ok).toBe(
			true
		);
	});
});

describe('SupportTicketService delivery marks', () => {
	it('records the admin message id and the moment it landed', () => {
		const created = write();
		const id = created.ok ? created.value.id : 0;

		clock.advance(5_000);
		service.markDelivered(id, 4242);

		const row = db.select().from(supportTickets).where(eq(supportTickets.id, id)).get()!;
		expect(row.status).toBe('delivered');
		expect(row.adminMessageId).toBe(4242);
		expect(row.deliveredAt?.getTime()).toBe(clock.now());
	});

	it('marks a request whose relay did not land, leaving it recoverable', () => {
		const created = write();
		const id = created.ok ? created.value.id : 0;

		service.markFailed(id);
		expect(service.findById(id)?.status).toBe('failed');

		// A later attempt that works moves it on: the column is the outcome of the last attempt.
		service.markDelivered(id, 7);
		expect(service.findById(id)?.status).toBe('delivered');
	});
});
