import type { PlanDTO } from '$lib/types';
import type { PlanRow } from '../db/schema';

/**
 * Row -> DTO lives in the domain, never hand-rolled in +page.server.ts (CLAUDE.md 1.4).
 * plans has no secret columns today, but routing every read through here is what keeps the next
 * added column from leaking by default.
 */
export function toPlanDTO(row: PlanRow): PlanDTO {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		durationDays: row.durationDays,
		priceMinor: row.priceMinor,
		currency: row.currency,
		trafficLimitBytes: row.trafficLimitBytes,
		isActive: row.isActive,
		sortOrder: row.sortOrder
	};
}
