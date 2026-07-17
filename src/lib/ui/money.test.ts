import { expect, test } from 'vitest';
import { CURRENCIES, MIN_CHARGE_MINOR } from '$lib/types';
import { formatMoney } from './money';

/**
 * formatMoney is the single place a price becomes human-readable (CLAUDE.md 4), so what is pinned
 * here is the contract from tech.md 5 — "money is an integer in minor units, usd and eur are
 * two-decimal, 100 minor units = 1 major" — not the ICU output. Exact locale strings drift between
 * Node and ICU versions; the major/minor split does not.
 */
function amountOf(formatted: string): { major: string; minor: string } {
	// \s covers the U+00A0 group separator ru-RU uses for thousands.
	const match = /(\d[\d\s.,]*)[.,](\d\d)(?!\d)/.exec(formatted);
	if (!match) throw new Error(`no two-decimal amount in ${JSON.stringify(formatted)}`);
	return { major: match[1].replace(/\D/g, ''), minor: match[2] };
}

test.each(CURRENCIES)('%s: 100 minor units render as one major unit', (currency) => {
	expect(amountOf(formatMoney(100, currency))).toEqual({ major: '1', minor: '00' });
});

test.each(CURRENCIES)('%s: minor units survive as cents, never as whole units', (currency) => {
	// Catches a missing division (would read 50,00) and a divisor that is not exactly 100.
	expect(amountOf(formatMoney(50, currency))).toEqual({ major: '0', minor: '50' });
	expect(amountOf(formatMoney(1, currency))).toEqual({ major: '0', minor: '01' });
});

test.each(CURRENCIES)('%s: no precision is lost on a four-figure price', (currency) => {
	expect(amountOf(formatMoney(49900, currency))).toEqual({ major: '499', minor: '00' });
	expect(amountOf(formatMoney(104999, currency))).toEqual({ major: '1049', minor: '99' });
});

test.each(CURRENCIES)('%s: the Stripe floor renders as half a major unit', (currency) => {
	// tech.md 7 freezes MIN_CHARGE_MINOR at 50 for both currencies.
	expect(amountOf(formatMoney(MIN_CHARGE_MINOR[currency], currency))).toEqual({
		major: '0',
		minor: '50'
	});
});

test('each currency carries its own symbol', () => {
	// Currency is part of the output, not decoration: usd and eur must never render identically.
	const rendered = CURRENCIES.map((currency) => formatMoney(49900, currency));
	expect(new Set(rendered).size).toBe(CURRENCIES.length);
});

test('the formatter cache does not leak one currency into another', () => {
	// money.ts memoises Intl.NumberFormat per currency. A cache keyed wrong would serve the first
	// currency's symbol to every later caller.
	const first = formatMoney(49900, 'usd');
	formatMoney(49900, 'eur');
	expect(formatMoney(49900, 'usd')).toBe(first);
});
