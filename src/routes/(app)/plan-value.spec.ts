import { describe, expect, it } from 'vitest';
import type { PlanDTO } from '$lib/types';
import { bestValuePlanId, formatDays, perDayMinor } from './plan-value';

/**
 * Derived from the acceptance criteria of A3, not from the code: tech.md 11 puts имя, срок and цена
 * on every card, and the mock highlights the best offer. The highlight has no column behind it, so
 * these tests pin the rule that replaces one — the lowest daily rate wins, ties go unmarked.
 */

function plan(id: number, priceMinor: number, durationDays: number): PlanDTO {
	return {
		id,
		name: `Тариф ${id}`,
		description: null,
		durationDays,
		priceMinor,
		currency: 'usd',
		trafficLimitBytes: 0,
		isActive: true,
		sortOrder: 0
	};
}

describe('formatDays', () => {
	it.each([
		[1, '1 день'],
		[2, '2 дня'],
		[3, '3 дня'],
		[4, '4 дня'],
		[5, '5 дней'],
		[7, '7 дней'],
		[11, '11 дней'],
		[21, '21 день'],
		[30, '30 дней'],
		[90, '90 дней'],
		[365, '365 дней']
	])('says "%i дней" the way Russian does: %s', (days, expected) => {
		expect(formatDays(days)).toBe(expected);
	});
});

describe('perDayMinor', () => {
	it('keeps the rate in minor units so Money stays the only formatter', () => {
		expect(perDayMinor(plan(1, 499, 30))).toBe(17);
	});

	it('rounds instead of truncating: a 149/7 plan is 21 a day, not 21.28', () => {
		expect(perDayMinor(plan(1, 149, 7))).toBe(21);
	});
});

describe('bestValuePlanId', () => {
	it('crowns the lowest daily rate, not the lowest price', () => {
		// 90 дней costs the most outright and the least per day. The badge must follow value.
		const plans = [plan(1, 149, 7), plan(2, 499, 30), plan(3, 1049, 90)];
		expect(bestValuePlanId(plans)).toBe(3);
	});

	it('leaves a single-plan deck unmarked: nothing is competing', () => {
		expect(bestValuePlanId([plan(1, 499, 30)])).toBeNull();
	});

	it('leaves an empty deck unmarked', () => {
		expect(bestValuePlanId([])).toBeNull();
	});

	it('marks nothing when two plans share the best rate', () => {
		// One crown over two equal offers reads as favouritism rather than as information.
		const plans = [plan(1, 100, 10), plan(2, 200, 20), plan(3, 900, 30)];
		expect(bestValuePlanId(plans)).toBeNull();
	});

	it('compares exact rates, so a rounding tie in the per-day line still has a winner', () => {
		// Both render as "21 в день" after Math.round; 148/7 is genuinely cheaper and takes the badge.
		const plans = [plan(1, 149, 7), plan(2, 148, 7)];
		expect(bestValuePlanId(plans)).toBe(2);
	});
});
