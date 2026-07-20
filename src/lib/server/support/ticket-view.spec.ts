import { beforeEach, describe, expect, it } from 'vitest';
import { addUser } from '$lib/server/billing/fixtures';
import type { Db } from '$lib/server/db/client';
import type { UserRow } from '$lib/server/db/schema';
import { createTestDb, TestClock } from '$lib/server/jobs/fixtures';
import { JobQueue } from '$lib/server/jobs/queue';
import { TICKET_MESSAGE_MAX } from '$lib/types';
import { SupportTicketService } from './ticket-service';
import { toTicketAdminView } from './ticket-view';

/**
 * A16's recent-requests list. The criterion from tech.md 11 is "список последних обращений" — newest
 * first, with enough to recognise a request and reach its author, and no more of the message than
 * that.
 */

const NOW = 1_784_000_000_000;

let db: Db;
let clock: TestClock;
let tickets: SupportTicketService;
let author: UserRow;

function fileTicket(message = 'VPN не подключается на iPhone, приложение V2Box.'): number {
	const created = tickets.create({ userId: author.id, message });
	if (!created.ok) throw new Error('the fixture must not hit the rate limit');
	return created.value.id;
}

beforeEach(() => {
	db = createTestDb();
	clock = new TestClock(NOW);
	tickets = new SupportTicketService(db, new JobQueue(db, clock.now), { now: clock.now });
	author = addUser(db);
});

describe('SupportTicketService.listRecent', () => {
	it('puts the newest request first', () => {
		const first = fileTicket();
		clock.advance(60_000);
		const second = fileTicket();

		expect(tickets.listRecent().map((row) => row.id)).toEqual([second, first]);
	});

	it('stops at the limit rather than exporting the whole table', () => {
		// Three per hour per person is the rule (CLAUDE.md 2), so the clock moves between the rest.
		for (let i = 0; i < 5; i++) {
			clock.advance(61 * 60_000);
			fileTicket();
		}

		expect(tickets.listRecent(2)).toHaveLength(2);
	});

	it('answers empty when nobody has written in', () => {
		expect(tickets.listRecent()).toEqual([]);
	});
});

describe('toTicketAdminView', () => {
	it('names the author the way the admin can answer them', () => {
		const id = fileTicket();

		const view = toTicketAdminView(tickets.findById(id)!, author);

		expect(view.author).toEqual({
			telegramId: author.telegramId,
			username: 'alex_k',
			name: 'Александр Ким'
		});
	});

	it('falls back to the Telegram id when somebody has no @username', () => {
		const anonymous = addUser(db, { telegramId: 700_000_222, username: null, lastName: null });
		const created = tickets.create({ userId: anonymous.id, message: 'Не работает ключ' });
		if (!created.ok) throw new Error('the fixture must not hit the rate limit');

		const view = toTicketAdminView(created.value, anonymous);

		expect(view.author.username).toBeNull();
		expect(view.author.telegramId).toBe(700_000_222);
		expect(view.author.name).toBe('Александр');
	});

	it('reports the status and when it was delivered', () => {
		const id = fileTicket();
		clock.advance(1_000);
		tickets.markDelivered(id, 42);

		const view = toTicketAdminView(tickets.findById(id)!, author);

		expect(view.status).toBe('delivered');
		expect(view.deliveredAt).toBe(NOW + 1_000);
	});

	it('leaves deliveredAt null while a request is still on its way', () => {
		const view = toTicketAdminView(tickets.findById(fileTicket())!, author);

		expect(view.status).toBe('new');
		expect(view.deliveredAt).toBeNull();
	});

	// --- the message stays where it was sent ------------------------------------------------------

	/**
	 * The full text already reached the admin's private chat, which is the delivery this feature
	 * promises. A second copy on a rendered page is one more place somebody's description of their
	 * problem can be screenshotted or cached.
	 */
	it('cuts a long message down to an excerpt', () => {
		const id = fileTicket('я'.repeat(TICKET_MESSAGE_MAX));

		const { excerpt } = toTicketAdminView(tickets.findById(id)!, author);

		expect(excerpt.length).toBeLessThan(TICKET_MESSAGE_MAX);
		expect(excerpt.endsWith('…')).toBe(true);
	});

	it('leaves a short message whole and unmarked', () => {
		const id = fileTicket('Не работает ключ');

		expect(toTicketAdminView(tickets.findById(id)!, author).excerpt).toBe('Не работает ключ');
	});

	it('never carries the full message under another name', () => {
		const long = 'я'.repeat(TICKET_MESSAGE_MAX);
		const id = fileTicket(long);

		const view = toTicketAdminView(tickets.findById(id)!, author);

		expect(JSON.stringify(view)).not.toContain(long);
	});
});
