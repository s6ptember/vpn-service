import { describe, expect, it } from 'vitest';
import { TICKET_MESSAGE_MAX, TICKET_MESSAGE_MIN } from '$lib/types';
import { TicketInputParser } from './input';

/**
 * tech.md 11 puts the bounds on the field itself: "textarea 10..2000". They are asserted against the
 * frozen constants rather than against literals, so a change to the contract fails here first.
 */

const parser = new TicketInputParser();

describe('TicketInputParser', () => {
	it('accepts a message inside the bounds', () => {
		const parsed = parser.parse({ message: 'VPN не подключается на Android.' });

		expect(parsed).toEqual({ ok: true, value: { message: 'VPN не подключается на Android.' } });
	});

	it('trims the message before storing it', () => {
		const parsed = parser.parse({ message: '   Не работает YouTube через VPN.   ' });

		expect(parsed.ok && parsed.value.message).toBe('Не работает YouTube через VPN.');
	});

	/**
	 * Whitespace must not buy the minimum: a screenful of newlines would otherwise pass the length
	 * rule and arrive in the admin's Telegram as an empty message.
	 */
	it('refuses whitespace dressed up as a message', () => {
		expect(parser.parse({ message: ' '.repeat(TICKET_MESSAGE_MIN + 20) }).ok).toBe(false);
	});

	it('refuses a message under the minimum and says so in Russian', () => {
		const parsed = parser.parse({ message: 'а'.repeat(TICKET_MESSAGE_MIN - 1) });

		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error).toContain(String(TICKET_MESSAGE_MIN));
	});

	it('takes a message of exactly the minimum length', () => {
		expect(parser.parse({ message: 'а'.repeat(TICKET_MESSAGE_MIN) }).ok).toBe(true);
	});

	it('takes a message of exactly the maximum length', () => {
		expect(parser.parse({ message: 'а'.repeat(TICKET_MESSAGE_MAX) }).ok).toBe(true);
	});

	it('refuses a message over the maximum', () => {
		const parsed = parser.parse({ message: 'а'.repeat(TICKET_MESSAGE_MAX + 1) });

		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error).toContain(String(TICKET_MESSAGE_MAX));
	});

	/** A form that sends no field at all must fail our own rule, not valibot's English one. */
	it('refuses a submission with no message field', () => {
		const parsed = parser.parse({});

		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error).toContain(String(TICKET_MESSAGE_MIN));
	});

	it('refuses a message that is not a string', () => {
		expect(parser.parse({ message: 42 }).ok).toBe(false);
	});
});
