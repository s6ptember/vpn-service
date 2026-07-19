/**
 * How the app writes a date. One formatter, so the subscription card, the plan deck and the
 * "продлит до" line can never disagree about what "18 августа" looks like.
 */

const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/** Without the year, for dates close enough that the year is noise. */
const SHORT_DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

export function formatDate(ms: number): string {
	return DATE.format(new Date(ms));
}

/** «18 августа» when it lands this year, «18 августа 2027 г.» when it does not. */
export function formatDateShort(ms: number, nowMs: number): string {
	const date = new Date(ms);
	return date.getFullYear() === new Date(nowMs).getFullYear()
		? SHORT_DATE.format(date)
		: DATE.format(date);
}
