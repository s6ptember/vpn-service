import type { PlanDTO } from '$lib/types';

/**
 * Pure presentation logic for the plan deck. It sits beside the route because it is presentation,
 * not domain: nothing here decides what a person is charged, only how the offer reads.
 */

const DAY_RULES = new Intl.PluralRules('ru-RU');

const DAY_WORDS: Record<Intl.LDMLPluralRule, string> = {
	zero: 'дней',
	one: 'день',
	two: 'дня',
	few: 'дня',
	many: 'дней',
	other: 'дня'
};

/** "1 день", "2 дня", "30 дней". A plan name is free text, so the duration line writes itself. */
export function formatDays(days: number): string {
	return `${days} ${DAY_WORDS[DAY_RULES.select(days)]}`;
}

/**
 * The column stores bytes; people talk in gigabytes. The other direction lives in the valibot schema
 * at $lib/server/plans/input.ts — a component cannot import a server module, and the frozen folder
 * layout (tech.md 4) offers no shared non-server home a developer may add one to.
 */
const BYTES_PER_GIB = 1024 ** 3;

export function gibFromBytes(bytes: number): number {
	return Math.round(bytes / BYTES_PER_GIB);
}

/** 0 means unlimited (tech.md 5), which is a promise rather than a number. */
export function formatTraffic(bytes: number): string {
	return bytes === 0 ? 'Безлимитный трафик' : `${gibFromBytes(bytes)} ГБ трафика`;
}

/** The same fact sized for a pill on a card, where there is room for a value and not a sentence. */
export function formatTrafficShort(bytes: number): string {
	return bytes === 0 ? 'Безлимит' : `${gibFromBytes(bytes)} ГБ`;
}

/** Price per day in minor units, so Money stays the only thing that formats a price (CLAUDE.md 4). */
export function perDayMinor(plan: PlanDTO): number {
	return Math.round(plan.priceMinor / plan.durationDays);
}

/**
 * The mock highlights one card with `best: true`. No column carries that flag and inventing one
 * would be a contract we cannot keep honest, so the badge is derived from the prices themselves:
 * the plan with the lowest daily rate is the best value, by definition.
 *
 * A tie leaves the deck unmarked — two equally good offers with one crown reads as favouritism, and
 * a single plan is not competing with anything.
 */
export function bestValuePlanId(plans: PlanDTO[]): number | null {
	if (plans.length < 2) return null;

	const rates = plans.map((plan) => ({ id: plan.id, rate: plan.priceMinor / plan.durationDays }));
	const cheapest = Math.min(...rates.map((r) => r.rate));
	const winners = rates.filter((r) => r.rate === cheapest);

	return winners.length === 1 ? winners[0].id : null;
}
