import { describe, expect, it } from 'vitest';
import { MIN_CHARGE_MINOR } from '$lib/types';
import { PlanInputParser } from './input';

/**
 * Derived from the contract, not the schema: tech.md 5 forbids a price under MIN_CHARGE_MINOR and
 * stores traffic in bytes, CLAUDE.md 2 says nothing unparsed reaches the domain, and the form is
 * FormData — every value arrives as a string, and an unchecked box arrives not at all.
 */

const parser = new PlanInputParser('usd');

const form = (overrides: Record<string, string> = {}) => ({
	name: '30 дней',
	description: 'Обычный выбор',
	durationDays: '30',
	priceMinor: '499',
	trafficLimitGib: '0',
	sortOrder: '1',
	isActive: 'on',
	...overrides
});

describe('PlanInputParser.parse', () => {
	it('turns a filled form into domain input', () => {
		const result = parser.parse(form());

		expect(result).toEqual({
			ok: true,
			value: {
				name: '30 дней',
				description: 'Обычный выбор',
				durationDays: 30,
				priceMinor: 499,
				trafficLimitBytes: 0,
				isActive: true,
				sortOrder: 1
			}
		});
	});

	it('converts gigabytes to bytes, the unit the column speaks', () => {
		const result = parser.parse(form({ trafficLimitGib: '50' }));

		expect(result.ok && result.value.trafficLimitBytes).toBe(50 * 1024 ** 3);
	});

	it('reads a missing checkbox as false: that is how HTML says unchecked', () => {
		const withoutCheckbox: Record<string, string> = form();
		delete withoutCheckbox.isActive;

		expect(parser.parse(withoutCheckbox)).toMatchObject({ ok: true, value: { isActive: false } });
	});

	it('stores an empty description as null rather than as an empty string', () => {
		const result = parser.parse(form({ description: '   ' }));

		expect(result.ok && result.value.description).toBeNull();
	});

	it('trims the name instead of storing the spaces around it', () => {
		const result = parser.parse(form({ name: '  30 дней  ' }));

		expect(result.ok && result.value.name).toBe('30 дней');
	});

	it('rejects a price below what Stripe will actually charge', () => {
		const result = parser.parse(form({ priceMinor: String(MIN_CHARGE_MINOR.usd - 1) }));

		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.priceMinor).toContain('не меньше');
	});

	it('accepts a price exactly at the floor', () => {
		const result = parser.parse(form({ priceMinor: String(MIN_CHARGE_MINOR.usd) }));

		expect(result.ok).toBe(true);
	});

	it('applies the floor of the currency it was built with', () => {
		// The parser carries the currency because the minimum depends on it, and the domain must not
		// read config itself. Both floors happen to be 50 today; the rule is what is pinned.
		const eur = new PlanInputParser('eur');

		expect(eur.parse(form({ priceMinor: String(MIN_CHARGE_MINOR.eur) })).ok).toBe(true);
		expect(eur.parse(form({ priceMinor: String(MIN_CHARGE_MINOR.eur - 1) })).ok).toBe(false);
	});

	it('rejects a zero-day plan: a subscription has to last something', () => {
		expect(parser.parse(form({ durationDays: '0' })).ok).toBe(false);
	});

	it('rejects a fractional or negative number where an integer belongs', () => {
		expect(parser.parse(form({ durationDays: '7.5' })).ok).toBe(false);
		expect(parser.parse(form({ durationDays: '-7' })).ok).toBe(false);
		expect(parser.parse(form({ priceMinor: '4,99' })).ok).toBe(false);
		expect(parser.parse(form({ sortOrder: '-1' })).ok).toBe(false);
	});

	it('rejects an empty name', () => {
		expect(parser.parse(form({ name: '   ' })).ok).toBe(false);
	});

	it('rejects a name longer than the column is meant to hold', () => {
		expect(parser.parse(form({ name: 'я'.repeat(65) })).ok).toBe(false);
	});

	it('reports every bad field at once, keyed by the input that caused it', () => {
		// One round trip per mistake would make the form unusable; the admin sees all of them.
		const result = parser.parse(form({ name: '', durationDays: 'много', priceMinor: '1' }));

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.keys(result.error).sort()).toEqual(['durationDays', 'name', 'priceMinor']);
	});

	it('refuses a body that is not a form at all', () => {
		expect(parser.parse(null).ok).toBe(false);
		expect(parser.parse('30 дней').ok).toBe(false);
	});

	it('answers a missing field in Russian, never with valibot prose', () => {
		// A schema message quotes a contract the admin cannot see, and it does so in English.
		const result = parser.parse({});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(Object.values(result.error).length).toBeGreaterThan(0);
		for (const message of Object.values(result.error)) {
			expect(message).toMatch(/^[А-Яа-яЁё]/);
		}
	});

	it('ignores fields the form did not ask for, currency above all', () => {
		// The price of a plan and the currency of the base are decided by the server, never by a
		// crafted POST (CLAUDE.md 2).
		const result = parser.parse(form({ currency: 'eur', id: '999', archivedAt: '0' }));

		expect(result.ok).toBe(true);
		expect(result.ok && result.value).not.toHaveProperty('currency');
		expect(result.ok && result.value).not.toHaveProperty('archivedAt');
	});
});

describe('PlanInputParser.parseId', () => {
	it('reads the id the form carries', () => {
		expect(parser.parseId({ id: '7' })).toEqual({ ok: true, value: 7 });
	});

	it('rejects a missing, empty or non-numeric id', () => {
		expect(parser.parseId({}).ok).toBe(false);
		expect(parser.parseId({ id: '' }).ok).toBe(false);
		expect(parser.parseId({ id: 'семь' }).ok).toBe(false);
		expect(parser.parseId({ id: '0' }).ok).toBe(false);
		expect(parser.parseId({ id: '-1' }).ok).toBe(false);
	});

	it('answers with a sentence a person can read, not a schema dump', () => {
		const result = parser.parseId({});

		expect(!result.ok && result.error).toBe('Не поняли, какой тариф изменить.');
	});
});
