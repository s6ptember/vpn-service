import { and, asc, eq, isNull } from 'drizzle-orm';
import type { PlanDTO } from '$lib/types';
import type { Db } from '../db/client';
import { plans } from '../db/schema';
import { toPlanDTO } from './mapper';

/**
 * Reference domain service: deps by constructor, no singleton imports, no HTTP knowledge.
 * A slice that needs plans takes this from the container, never touches the table itself.
 */
export class PlanService {
	constructor(private readonly db: Db) {}

	/** Active, non-archived plans in display order. Deletes are soft, so archivedAt must be filtered. */
	listActive(): PlanDTO[] {
		const rows = this.db
			.select()
			.from(plans)
			.where(and(eq(plans.isActive, true), isNull(plans.archivedAt)))
			.orderBy(asc(plans.sortOrder), asc(plans.id))
			.all();

		return rows.map(toPlanDTO);
	}

	findById(id: number): PlanDTO | null {
		const row = this.db.select().from(plans).where(eq(plans.id, id)).get();
		return row ? toPlanDTO(row) : null;
	}
}
