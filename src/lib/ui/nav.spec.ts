import { describe, expect, it } from 'vitest';
import { SECTIONS, indexOfPath } from './nav';

// Derived from tech.md 11, not from nav.ts: the section list is frozen there and the swipe order is
// the index order, so a reorder or a rename has to break a test rather than a user's muscle memory.
describe('SECTIONS', () => {
	it('matches the frozen list in tech.md 11', () => {
		expect(SECTIONS.map(({ index, href, label }) => ({ index, href, label }))).toEqual([
			{ index: 0, href: '/support', label: 'Поддержка' },
			{ index: 1, href: '/', label: 'Главная' },
			{ index: 2, href: '/profile', label: 'Профиль' }
		]);
	});

	it('carries an icon per section', () => {
		for (const section of SECTIONS) expect(section.icon).toBeDefined();
	});

	it('indexes positionally, so SECTIONS[n] is the section swiping lands on', () => {
		SECTIONS.forEach((section, position) => expect(section.index).toBe(position));
	});
});

describe('indexOfPath', () => {
	it('maps each section href to its own index', () => {
		for (const section of SECTIONS) expect(indexOfPath(section.href)).toBe(section.index);
	});

	// tech.md 11: Главная is the default section.
	it.each(['/nope', '/admin', '/dev/kitchen-sink', ''])('lands %j on Главная', (path) => {
		expect(indexOfPath(path)).toBe(1);
	});

	// tech.md 11: админка живёт под /profile/admin — a deep admin route is still Профиль.
	it.each(['/profile/admin', '/profile/admin/plans', '/profile/admin/plans/7'])(
		'keeps %j on Профиль',
		(path) => {
			expect(indexOfPath(path)).toBe(2);
		}
	);

	it('keeps nested support routes on Поддержка', () => {
		expect(indexOfPath('/support/faq')).toBe(0);
	});

	// A prefix match must respect segment boundaries: `/profilezzz` is not inside `/profile`.
	// A naive startsWith() passes every other case here and fails exactly this one.
	it.each(['/profilezzz', '/supporting', '/profile-admin'])(
		'does not put %j in a section it merely prefixes',
		(path) => {
			expect(indexOfPath(path)).toBe(1);
		}
	);

	// `/` prefixes literally every path, so it must match exactly or it swallows the whole app.
	it('does not let the root section swallow other paths', () => {
		expect(indexOfPath('/profile')).not.toBe(1);
		expect(indexOfPath('/support')).not.toBe(1);
	});

	it('always returns an index that indexes SECTIONS', () => {
		for (const path of ['/', '/support', '/profile', '/profile/admin', '/nope', '/x/y/z']) {
			const index = indexOfPath(path);
			expect(SECTIONS[index]).toBeDefined();
		}
	});
});
