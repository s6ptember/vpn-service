import { describe, expect, it } from 'vitest';
import { CheckoutInputParser, PromoCheckInputParser, PromoInputParser } from './input';

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

	it('carries a promo code up with the plan', () => {
		// tech.md 10, step 1: the client posts { planId, promoCode? } in one submit.
		expect(parser.parse({ planId: '42', promoCode: 'START30' })).toEqual({
			ok: true,
			value: { planId: 42, promoCode: 'START30' }
		});
	});

	it('normalises the code to the spelling the column holds', () => {
		// tech.md 5 stores codes UPPERCASE and SQLite compares text byte for byte: a code that is not
		// upper-cased here simply would not be found, and the purchase would silently lose its discount.
		expect(parser.parse({ planId: '42', promoCode: ' start30 ' })).toEqual({
			ok: true,
			value: { planId: 42, promoCode: 'START30' }
		});
	});

	it.each([
		['an omitted field', {}],
		['an empty field', { promoCode: '' }],
		['whitespace only', { promoCode: '   ' }]
	])('reads %s as no code at all rather than as a bad one', (_case, raw) => {
		// Most purchases carry no code, and none of them may be refused for it.
		const parsed = parser.parse({ planId: '42', ...raw });

		expect(parsed).toEqual({ ok: true, value: { planId: 42, promoCode: undefined } });
	});

	it.each([
		['punctuation', { promoCode: 'START_30' }],
		['spaces inside', { promoCode: 'START 30' }],
		['Cyrillic that looks Latin', { promoCode: 'СТАРТ30' }],
		['a code longer than the column expects', { promoCode: 'A'.repeat(33) }],
		['something that is not a string', { promoCode: 42 }]
	])('refuses %s', (_case, raw) => {
		const parsed = parser.parse({ planId: '42', ...raw });

		expect(parsed.ok).toBe(false);
		expect(parsed.ok === false && parsed.error).toBe(
			'Промокод состоит из латинских букв, цифр и дефисов.'
		);
	});
});

describe('PromoCheckInputParser.parse', () => {
	const check = new PromoCheckInputParser();

	it('hands the domain the normalised code', () => {
		expect(check.parse({ promoCode: 'start30' })).toEqual({ ok: true, value: 'START30' });
	});

	it('asks for a code rather than shrugging at an empty submit', () => {
		// Unlike the purchase form, an empty field here is a slip: checking nothing helps nobody.
		expect(check.parse({ promoCode: '  ' })).toEqual({ ok: false, error: 'Введите промокод.' });
	});
});

describe('PromoInputParser.parse', () => {
	const admin = new PromoInputParser();

	const form = (overrides: Record<string, string> = {}) => ({
		code: 'start30',
		discountType: 'percent',
		discountValue: '30',
		maxUses: '',
		validFrom: '',
		validUntil: '',
		isActive: 'on',
		...overrides
	});

	it('stores the code upper-cased, whatever the admin typed', () => {
		// A code minted lowercase would be unreachable from the customer's field, which upper-cases.
		const parsed = admin.parse(form());

		expect(parsed.ok && parsed.value.code).toBe('START30');
	});

	it('reads an empty limit as unlimited', () => {
		// null is the column's word for it (tech.md 5); 0 would mean a code spent on creation.
		const parsed = admin.parse(form({ maxUses: '' }));

		expect(parsed.ok && parsed.value.maxUses).toBeNull();
	});

	it('opens the window at the first moment of the day and closes it at the last', () => {
		/**
		 * An admin who types the 31st means the code works all of the 31st. PromoValidator compares
		 * against a moment, so a window closing at midnight would retire the code a day early.
		 */
		const parsed = admin.parse(form({ validFrom: '2026-07-01', validUntil: '2026-07-31' }));

		expect(parsed.ok && parsed.value.validFrom?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
		expect(parsed.ok && parsed.value.validUntil?.toISOString()).toBe('2026-07-31T23:59:59.999Z');
	});

	it('refuses a percentage over 100', () => {
		const parsed = admin.parse(form({ discountType: 'percent', discountValue: '101' }));

		expect(parsed.ok).toBe(false);
		// Keyed by field, so the form can put it under the input that caused it.
		expect(parsed.ok === false && parsed.error.discountValue).toBe(
			'Размер скидки: для процентов не больше 100'
		);
	});

	it('allows a fixed discount larger than any percentage could be', () => {
		// Minor units, not percent: 5000 is a perfectly ordinary fixed discount.
		expect(admin.parse(form({ discountType: 'fixed', discountValue: '5000' })).ok).toBe(true);
	});

	it('refuses a window that ends before it starts', () => {
		const parsed = admin.parse(form({ validFrom: '2026-07-31', validUntil: '2026-07-01' }));

		expect(parsed.ok === false && parsed.error.validUntil).toBe('Окончание: не раньше начала');
	});

	it('reads a missing checkbox as off', () => {
		// An unchecked box submits nothing at all, which is how HTML says false.
		const withoutBox: Record<string, string> = form();
		delete withoutBox.isActive;

		const parsed = admin.parse(withoutBox);

		expect(parsed.ok && parsed.value.isActive).toBe(false);
	});
});
