import type { Currency } from '$lib/types';

/**
 * Money is stored and passed around in minor units everywhere (tech.md 5). This is the single place
 * that turns them into major units for a human: no other module divides by 100.
 * Zero-decimal currencies (jpy) are out of contract, so the divisor is a constant.
 */
const MINOR_PER_MAJOR = 100;

// Constructing Intl.NumberFormat is expensive and price lists render it per row. The cache is pure:
// it holds formatters keyed by currency, never request data.
const formatters = new Map<Currency, Intl.NumberFormat>();

function formatterFor(currency: Currency): Intl.NumberFormat {
	const cached = formatters.get(currency);
	if (cached) return cached;

	// Currency codes travel lowercase (Stripe format), Intl wants ISO 4217 uppercase.
	const created = new Intl.NumberFormat('ru-RU', {
		style: 'currency',
		currency: currency.toUpperCase()
	});
	formatters.set(currency, created);
	return created;
}

export function formatMoney(minor: number, currency: Currency): string {
	return formatterFor(currency).format(minor / MINOR_PER_MAJOR);
}
