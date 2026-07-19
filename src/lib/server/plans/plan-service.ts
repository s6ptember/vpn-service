import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Currency, PlanDTO, Result } from '$lib/types';
import type { Db } from '../db/client';
import { plans } from '../db/schema';
import type { PlanInput } from './input';
import { toPlanDTO } from './mapper';

export interface PlanServiceOptions {
	now?: () => number;
}

/**
 * Reference domain service: deps by constructor, no singleton imports, no HTTP knowledge.
 * A slice that needs plans takes this from the container, never touches the table itself.
 */
export class PlanService {
	private readonly now: () => number;

	constructor(
		private readonly db: Db,
		/** One currency for the whole base (tech.md 5), so a plan never carries its own. */
		private readonly currency: Currency,
		opts: PlanServiceOptions = {}
	) {
		this.now = opts.now ?? Date.now;
	}

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

	/**
	 * What the admin can still act on: live plans, hidden ones included, archived ones excluded.
	 *
	 * Archived rows stay out because PlanDTO carries no archive flag (tech.md 7, frozen) — listing
	 * them would leave the admin unable to tell a retired plan from a merely hidden one, and every
	 * edit on one comes back refused anyway. Archiving therefore reads as a delete in the UI while
	 * the row itself survives for the orders that reference it.
	 */
	listEditable(): PlanDTO[] {
		const rows = this.db
			.select()
			.from(plans)
			.where(isNull(plans.archivedAt))
			.orderBy(asc(plans.sortOrder), asc(plans.id))
			.all();

		return rows.map(toPlanDTO);
	}

	findById(id: number): PlanDTO | null {
		const row = this.db.select().from(plans).where(eq(plans.id, id)).get();
		return row ? toPlanDTO(row) : null;
	}

	create(input: PlanInput): PlanDTO {
		const timestamp = new Date(this.now());

		const row = this.db
			.insert(plans)
			.values({ ...input, currency: this.currency, createdAt: timestamp, updatedAt: timestamp })
			.returning()
			.get();

		return toPlanDTO(row);
	}

	/**
	 * Both failures are stale-page outcomes rather than bugs, so they come back as Result
	 * (CLAUDE.md 3): the admin edits a plan somebody archived in another tab, or one that is gone.
	 * Archiving is the delete path and must be final — an edit that revives a retired plan would
	 * quietly put it back in front of customers.
	 */
	update(id: number, input: PlanInput): Result<PlanDTO, 'not_found' | 'archived'> {
		const existing = this.db.select().from(plans).where(eq(plans.id, id)).get();

		if (!existing) return { ok: false, error: 'not_found' };
		if (existing.archivedAt) return { ok: false, error: 'archived' };

		const row = this.db
			.update(plans)
			.set({ ...input, currency: this.currency, updatedAt: new Date(this.now()) })
			.where(eq(plans.id, id))
			.returning()
			.get();

		return { ok: true, value: toPlanDTO(row) };
	}

	/**
	 * Soft delete (tech.md 5): orders reference plans, so a row is retired, never removed.
	 * Idempotent — archiving twice reports the plan it already archived instead of moving the date,
	 * which keeps a double-submitted form from rewriting history.
	 */
	archive(id: number): Result<PlanDTO, 'not_found'> {
		const existing = this.db.select().from(plans).where(eq(plans.id, id)).get();

		if (!existing) return { ok: false, error: 'not_found' };
		if (existing.archivedAt) return { ok: true, value: toPlanDTO(existing) };

		const timestamp = new Date(this.now());

		// isActive goes down with it: listActive already filters on archivedAt, but leaving a live
		// flag behind means every future read has to remember which column wins.
		const row = this.db
			.update(plans)
			.set({ archivedAt: timestamp, isActive: false, updatedAt: timestamp })
			.where(eq(plans.id, id))
			.returning()
			.get();

		return { ok: true, value: toPlanDTO(row) };
	}
}
