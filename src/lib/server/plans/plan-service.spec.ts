import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { plans } from '../db/schema';
import { PlanService } from './plan-service';

/**
 * Derived from the slice's acceptance criteria, not its code: tech.md 11 says the home shows
 * "карточки активных тарифов, отсортированы sortOrder", and tech.md 5 makes deletes soft. So an
 * inactive plan and an archived plan must both be invisible — A4 archives instead of deleting, and
 * this filter is the only thing standing between a retired plan and a customer's screen.
 */

const NOW = new Date(1_700_000_000_000);

let db: Db;
let service: PlanService;

function addPlan(
	id: number,
	name: string,
	overrides: Partial<{ isActive: boolean; archivedAt: Date | null; sortOrder: number }> = {}
) {
	db.insert(plans)
		.values({
			id,
			name,
			description: null,
			durationDays: 30,
			priceMinor: 499,
			currency: 'usd',
			trafficLimitBytes: 0,
			isActive: overrides.isActive ?? true,
			sortOrder: overrides.sortOrder ?? 0,
			archivedAt: overrides.archivedAt ?? null,
			createdAt: NOW,
			updatedAt: NOW
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
	service = new PlanService(db);
});

describe('PlanService.listActive', () => {
	it('hides a deactivated plan', () => {
		addPlan(1, 'Живой');
		addPlan(2, 'Выключенный', { isActive: false });

		expect(service.listActive().map((p) => p.name)).toEqual(['Живой']);
	});

	it('hides an archived plan even while it is still flagged active', () => {
		// Archiving is the delete path (tech.md 5); a stale isActive must not resurrect the plan.
		addPlan(1, 'Живой');
		addPlan(2, 'Архивный', { isActive: true, archivedAt: NOW });

		expect(service.listActive().map((p) => p.name)).toEqual(['Живой']);
	});

	it('orders by sortOrder, then by id for a tie', () => {
		addPlan(3, 'Третий', { sortOrder: 2 });
		addPlan(1, 'Первый', { sortOrder: 0 });
		addPlan(2, 'Второй', { sortOrder: 1 });
		addPlan(4, 'Второй-дубль', { sortOrder: 1 });

		expect(service.listActive().map((p) => p.name)).toEqual([
			'Первый',
			'Второй',
			'Второй-дубль',
			'Третий'
		]);
	});

	it('returns an empty list rather than throwing when nothing is active', () => {
		addPlan(1, 'Выключенный', { isActive: false });
		expect(service.listActive()).toEqual([]);
	});

	it('returns DTOs, never rows: no column outside PlanDTO crosses the boundary', () => {
		addPlan(1, 'Живой');

		const [dto] = service.listActive();
		expect(Object.keys(dto).sort()).toEqual(
			[
				'currency',
				'description',
				'durationDays',
				'id',
				'isActive',
				'name',
				'priceMinor',
				'sortOrder',
				'trafficLimitBytes'
			].sort()
		);
		// createdAt/updatedAt/archivedAt are row columns and must not leak into the DTO.
		expect(dto).not.toHaveProperty('archivedAt');
		expect(dto).not.toHaveProperty('createdAt');
	});
});

describe('PlanService.findById', () => {
	it('finds a plan by id', () => {
		addPlan(1, 'Живой');
		expect(service.findById(1)?.name).toBe('Живой');
	});

	it('returns null for an id that does not exist', () => {
		expect(service.findById(404)).toBeNull();
	});
});
