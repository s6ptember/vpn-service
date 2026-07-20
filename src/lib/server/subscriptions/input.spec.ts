import { describe, expect, it } from 'vitest';
import { ReconcileInputParser } from './input';

/**
 * The admin types a Telegram id into the reconcile form. Nothing typed reaches the domain unparsed
 * (CLAUDE.md 2), and every refusal has to name the field it belongs to so the form can show it under
 * the right input.
 */

const parser = new ReconcileInputParser();

describe('ReconcileInputParser', () => {
	it('accepts a Telegram id and hands back a number', () => {
		const parsed = parser.parse({ telegramId: '700000111' });

		expect(parsed).toEqual({ ok: true, value: { telegramId: 700_000_111 } });
	});

	it('accepts an id somebody pasted with spaces around it', () => {
		const parsed = parser.parse({ telegramId: '  700000111  ' });

		expect(parsed.ok && parsed.value.telegramId).toBe(700_000_111);
	});

	it.each([
		['', 'an empty field'],
		['   ', 'only spaces'],
		['abc', 'letters'],
		['700_000_111', 'digit separators'],
		['-5', 'a negative number'],
		['12.5', 'a decimal'],
		['0', 'zero']
	])('refuses %j — %s', (telegramId) => {
		const parsed = parser.parse({ telegramId });

		expect(parsed.ok).toBe(false);
		expect(parsed.ok === false && parsed.error.telegramId).toBeTruthy();
	});

	/** A field the form never sent must fail our own rule, in Russian, not valibot's in English. */
	it('refuses a missing field with a message the admin can read', () => {
		const parsed = parser.parse({});

		expect(parsed.ok).toBe(false);
		expect(parsed.ok === false && parsed.error.telegramId).toMatch(/Telegram ID/);
	});

	/**
	 * 400 digits pass the digits-only regex and come out of Number() as Infinity, which would fail
	 * the integer check before either bound was reached. Length is checked first so that is
	 * impossible.
	 */
	it('refuses an id far too long to be one, without overflowing', () => {
		const parsed = parser.parse({ telegramId: '9'.repeat(400) });

		expect(parsed.ok).toBe(false);
		expect(parsed.ok === false && parsed.error.telegramId).toMatch(/длинный/);
	});

	it('refuses an id past the safe integer range', () => {
		const parsed = parser.parse({ telegramId: String(Number.MAX_SAFE_INTEGER) + '0' });

		expect(parsed.ok).toBe(false);
	});
});
