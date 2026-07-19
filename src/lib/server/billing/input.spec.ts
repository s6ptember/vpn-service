import { describe, expect, it } from 'vitest';
import { CheckoutInputParser } from './input';

/**
 * The whole input surface of `?/createCheckout`. CLAUDE.md 2 requires every action input to be
 * parsed by a schema before the domain sees it, and this is the only thing making that true for
 * the one action that spends money.
 *
 * The cases are the ones a hand-written POST would try, not the ones the form sends.
 */

const parser = new CheckoutInputParser();

describe('CheckoutInputParser.parse', () => {
	it('accepts the plan id the form actually posts', () => {
		expect(parser.parse({ planId: '42' })).toEqual({ ok: true, value: { planId: 42 } });
	});

	it('ignores anything else posted alongside it', () => {
		// The point of the schema: there is nowhere for a price to arrive, so none can be believed.
		const parsed = parser.parse({ planId: '42', finalPriceMinor: '1', currency: 'jpy' });

		expect(parsed).toEqual({ ok: true, value: { planId: 42 } });
	});

	it.each([
		['a missing field', {}],
		['an empty field', { planId: '' }],
		['a decimal', { planId: '1.5' }],
		['scientific notation', { planId: '1e3' }],
		['a negative id', { planId: '-1' }],
		['zero', { planId: '0' }],
		['words', { planId: 'первый' }],
		['a number that is not a string', { planId: 42 }],
		['whitespace only', { planId: '   ' }],
		// 400 digits pass a naive regex and come out of Number() as Infinity.
		['a number long enough to overflow', { planId: '9'.repeat(400) }],
		// Past Number.MAX_SAFE_INTEGER a comparison stops meaning what it reads like.
		['an id beyond the safe integer range', { planId: '99999999999999999999' }]
	])('refuses %s', (_case, raw) => {
		const parsed = parser.parse(raw);

		expect(parsed.ok).toBe(false);
		// The message is for a person, so it says what to do rather than quoting a schema.
		expect(parsed.ok === false && parsed.error).toBe('Не поняли, какой тариф вы выбрали.');
	});

	it('trims what a person could plausibly paste', () => {
		expect(parser.parse({ planId: ' 42 ' })).toEqual({ ok: true, value: { planId: 42 } });
	});
});
