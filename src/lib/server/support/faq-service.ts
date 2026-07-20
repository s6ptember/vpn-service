import { asc, eq } from 'drizzle-orm';
import type { FaqItemDTO } from '$lib/types';
import type { Db } from '../db/client';
import { faqItems } from '../db/schema';
import { toFaqItemDTO } from './mapper';

/**
 * The `faq_items` table, read-only (A13).
 *
 * There is no create, update or archive here and that is not an omission: tech.md 16 puts editing
 * the FAQ from the admin explicitly outside v1 — the questions are edited in `scripts/seed.ts` and
 * arrive with a deploy. A write path added "for later" would be an unreviewed admin surface nobody
 * asked for.
 */
export class FaqService {
	constructor(private readonly db: Db) {}

	/**
	 * The questions the support screen shows, in display order.
	 *
	 * `isActive` is the switch that retires a question without deleting it — the table has no
	 * `archivedAt`, so unlike a plan this is the only way to take one down, and an answer that has
	 * gone wrong must stop being shown the moment somebody flips the flag.
	 *
	 * Ordered by `sortOrder` then `id`, the same tiebreak PlanService uses: the seed gives several
	 * rows the default 0, and without the second key SQLite is free to return them in any order it
	 * likes, so the FAQ would reshuffle itself between two identical loads.
	 */
	listActive(): FaqItemDTO[] {
		return this.db
			.select()
			.from(faqItems)
			.where(eq(faqItems.isActive, true))
			.orderBy(asc(faqItems.sortOrder), asc(faqItems.id))
			.all()
			.map(toFaqItemDTO);
	}
}
