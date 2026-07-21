import { describe, expect, it } from 'vitest';
import { formatTrafficUsage, trafficUsageRatio } from './traffic';

const GIB = 1024 ** 3;

describe('formatTrafficUsage', () => {
	it('names the limit when there is one and nothing has loaded yet', () => {
		expect(formatTrafficUsage(null, 50 * GIB)).toBe('Лимит 50 ГБ');
	});

	it('promises no limit when the plan is unbounded and nothing has loaded yet', () => {
		expect(formatTrafficUsage(null, 0)).toBe('Безлимитный трафик');
	});

	it('reads used against the limit once Marzban has answered', () => {
		expect(formatTrafficUsage(3 * GIB, 50 * GIB)).toBe('Использовано 3 из 50 ГБ');
	});

	it('reads used with no ceiling on an unlimited plan', () => {
		expect(formatTrafficUsage(3 * GIB, 0)).toBe('Использовано 3 ГБ · безлимит');
	});
});

describe('trafficUsageRatio', () => {
	it('is null with nothing loaded yet', () => {
		expect(trafficUsageRatio(null, 50 * GIB)).toBeNull();
	});

	it('is null on an unlimited plan: there is no ceiling to measure against', () => {
		expect(trafficUsageRatio(3 * GIB, 0)).toBeNull();
	});

	it('is the plain share once both numbers are known', () => {
		expect(trafficUsageRatio(25 * GIB, 50 * GIB)).toBe(0.5);
	});

	it('clamps at 1 when usage has run past the limit', () => {
		expect(trafficUsageRatio(80 * GIB, 50 * GIB)).toBe(1);
	});
});
