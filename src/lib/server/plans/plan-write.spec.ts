import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../db/client';
import { plans } from '../db/schema';
import type { PlanInput } from './input';
import { PlanService } from './plan-service';

/**
 * Derived from A4's acceptance criteria: "CRUD тарифов, архивирование вместо удаления".
 *
 * The rules these pin are the ones a UI cannot enforce: a row is retired rather than deleted
 * (tech.md 5, orders reference plans), archiving is final and idempotent, and the currency of the
 * base is never taken from whoever submitted the form (CLAUDE.md 2).
 */

const NOW = 1_700_000_000_000;
const LATER = NOW + 60_000;

let db: Db;
let clock: number;
let service: PlanService;

function input(overrides: Partial<PlanInput> = {}): PlanInput {
	return {
		name: 'Новый',
		description: null,
		durationDays: 30,
		priceMinor: 499,
		trafficLimitBytes: 0,
		isActive: true,
		sortOrder: 0,
		...overrides
	};
}

const rowOf = (id: number) => db.select().from(plans).where(eq(plans.id, id)).get();

beforeEach(() => {
	db = createDb(':memory:');
	const ddl = readFileSync('./drizzle/0000_init.sql', 'utf8');
	for (const statement of ddl.split('--> statement-breakpoint')) {
		const sql = statement.trim();
		if (sql) db.run(sql as never);
	}

	clock = NOW;
	service = new PlanService(db, 'usd', { now: () => clock });
});

describe('PlanService.create', () => {
	it('returns the stored plan as a DTO', () => {
		const plan = service.create(input({ name: '30 дней', priceMinor: 499 }));

		expect(plan.id).toBeGreaterThan(0);
		expect(plan.name).toBe('30 дней');
		expect(plan.priceMinor).toBe(499);
	});

	it('stamps the currency of the base, whatever the caller sends', () => {
		// The form has no currency field by design; one base, one currency (tech.md 5).
		const eurService = new PlanService(db, 'eur', { now: () => clock });

		expect(service.create(input()).currency).toBe('usd');
		expect(eurService.create(input()).currency).toBe('eur');
	});

	it('creates a live plan: it shows up on the home list straight away', () => {
		const plan = service.create(input({ name: 'Живой' }));

		expect(service.listActive().map((p) => p.id)).toContain(plan.id);
	});

	it('honours isActive false: the plan exists for the admin but not for a customer', () => {
		const plan = service.create(input({ isActive: false }));

		expect(service.listEditable().map((p) => p.id)).toContain(plan.id);
		expect(service.listActive()).toEqual([]);
	});
});

describe('PlanService.update', () => {
	it('writes every field it was given', () => {
		const created = service.create(input());
		clock = LATER;

		const result = service.update(
			created.id,
			input({
				name: 'Переименован',
				description: 'Выгоднее всего',
				durationDays: 90,
				priceMinor: 1049,
				trafficLimitBytes: 1024 ** 3,
				isActive: false,
				sortOrder: 5
			})
		);

		expect(result).toEqual({
			ok: true,
			value: {
				id: created.id,
				name: 'Переименован',
				description: 'Выгоднее всего',
				durationDays: 90,
				priceMinor: 1049,
				currency: 'usd',
				trafficLimitBytes: 1024 ** 3,
				isActive: false,
				sortOrder: 5
			}
		});
	});

	it('moves updatedAt and leaves createdAt where it was', () => {
		const created = service.create(input());
		clock = LATER;
		service.update(created.id, input({ name: 'Другое' }));

		const row = rowOf(created.id);
		expect(row?.createdAt.getTime()).toBe(NOW);
		expect(row?.updatedAt.getTime()).toBe(LATER);
	});

	it('reports not_found for an id that never existed', () => {
		expect(service.update(404, input())).toEqual({ ok: false, error: 'not_found' });
	});

	it('refuses to edit an archived plan', () => {
		// Archiving is the delete path. An edit that revived a retired plan would quietly put it
		// back in front of customers — exactly what a stale admin tab would do.
		const created = service.create(input());
		service.archive(created.id);

		expect(service.update(created.id, input({ name: 'Воскрешён' }))).toEqual({
			ok: false,
			error: 'archived'
		});
		expect(rowOf(created.id)?.name).toBe('Новый');
	});
});

describe('PlanService.archive', () => {
	it('stamps archivedAt instead of deleting the row', () => {
		const created = service.create(input());
		clock = LATER;

		expect(service.archive(created.id).ok).toBe(true);

		const row = rowOf(created.id);
		expect(row).toBeDefined();
		expect(row?.archivedAt?.getTime()).toBe(LATER);
	});

	it('takes isActive down with it, so no read has to decide which column wins', () => {
		const created = service.create(input({ isActive: true }));
		service.archive(created.id);

		expect(rowOf(created.id)?.isActive).toBe(false);
	});

	it('hides the plan from customers and from the admin list alike', () => {
		const kept = service.create(input({ name: 'Живой' }));
		const gone = service.create(input({ name: 'Архивный' }));

		service.archive(gone.id);

		expect(service.listActive().map((p) => p.id)).toEqual([kept.id]);
		expect(service.listEditable().map((p) => p.id)).toEqual([kept.id]);
	});

	it('is idempotent: a double submit does not move the archive date', () => {
		const created = service.create(input());
		clock = LATER;
		service.archive(created.id);

		clock = LATER + 60_000;
		const second = service.archive(created.id);

		expect(second.ok).toBe(true);
		expect(rowOf(created.id)?.archivedAt?.getTime()).toBe(LATER);
	});

	it('reports not_found for an id that never existed', () => {
		expect(service.archive(404)).toEqual({ ok: false, error: 'not_found' });
	});
});

describe('PlanService.listEditable', () => {
	it('keeps hidden plans and drops archived ones, ordered by sortOrder then id', () => {
		const third = service.create(input({ name: 'Третий', sortOrder: 2 }));
		const first = service.create(input({ name: 'Первый', sortOrder: 0 }));
		const hidden = service.create(input({ name: 'Скрытый', sortOrder: 1, isActive: false }));
		const archived = service.create(input({ name: 'Архивный', sortOrder: 1 }));

		service.archive(archived.id);

		expect(service.listEditable().map((p) => p.id)).toEqual([first.id, hidden.id, third.id]);
	});
});
