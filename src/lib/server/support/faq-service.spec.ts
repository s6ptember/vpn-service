import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { faqItems } from '../db/schema';
import { FaqService } from './faq-service';

/**
 * Derived from the acceptance criteria, not from the code: tech.md 11 says Поддержка shows
 * "аккордеон FAQ из faqItems", and the table carries `isActive` and `sortOrder`. So a switched-off
 * question must not reach the screen, and the order must be the one the admin set — twice in a row.
 */

let db: Db;
let service: FaqService;

function addFaq(
	id: number,
	question: string,
	overrides: Partial<{ isActive: boolean; sortOrder: number }> = {}
) {
	db.insert(faqItems)
		.values({
			id,
			question,
			answer: `Ответ на «${question}»`,
			sortOrder: overrides.sortOrder ?? 0,
			isActive: overrides.isActive ?? true
		})
		.run();
}

beforeEach(() => {
	db = createDb(':memory:');
	const ddl = readFileSync('./drizzle/0000_init.sql', 'utf8');
	for (const statement of ddl.split('--> statement-breakpoint')) {
		const sql = statement.trim();
		if (sql) db.run(sql as never);
	}
	service = new FaqService(db);
});

describe('FaqService.listActive', () => {
	it('hides a question that was switched off', () => {
		addFaq(1, 'Как подключиться?');
		addFaq(2, 'Устаревший ответ', { isActive: false });

		expect(service.listActive().map((item) => item.question)).toEqual(['Как подключиться?']);
	});

	it('returns the questions in the order the admin set', () => {
		addFaq(1, 'Третий', { sortOrder: 2 });
		addFaq(2, 'Первый', { sortOrder: 0 });
		addFaq(3, 'Второй', { sortOrder: 1 });

		expect(service.listActive().map((item) => item.question)).toEqual([
			'Первый',
			'Второй',
			'Третий'
		]);
	});

	/**
	 * The seed leaves every question on the default sortOrder 0. Without the id tiebreak SQLite may
	 * return those rows in any order it likes, and the FAQ would reshuffle itself between two loads
	 * of the same screen.
	 */
	it('keeps a stable order when several questions share one sortOrder', () => {
		addFaq(3, 'Третий');
		addFaq(1, 'Первый');
		addFaq(2, 'Второй');

		expect(service.listActive().map((item) => item.id)).toEqual([1, 2, 3]);
	});

	it('answers with an empty list rather than throwing when nothing is seeded', () => {
		expect(service.listActive()).toEqual([]);
	});
});
