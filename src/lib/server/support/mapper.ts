import type { FaqItemDTO } from '$lib/types';
import type { FaqItemRow } from '../db/schema';

/**
 * Row -> DTO in the domain, never hand-rolled in +page.server.ts (CLAUDE.md 1.4).
 *
 * `sortOrder` and `isActive` stay behind: they decide which questions appear and in what order,
 * which is this domain's business and not the accordion's. FaqItemDTO (tech.md 7, frozen) carries
 * neither, so the list arrives already ordered and already filtered.
 */
export function toFaqItemDTO(row: FaqItemRow): FaqItemDTO {
	return {
		id: row.id,
		question: row.question,
		answer: row.answer
	};
}
