import { LifeBuoy, Home, User } from 'lucide-svelte';

/** Navigation is data, not markup: the island, the swipe and the routes all read this one list.
 *  Order is fixed by `index` — it is the swipe order, so appending is not free. */
export const SECTIONS = [
	{ index: 0, href: '/support', label: 'Поддержка', icon: LifeBuoy },
	{ index: 1, href: '/', label: 'Главная', icon: Home },
	{ index: 2, href: '/profile', label: 'Профиль', icon: User }
] as const;

export type Section = (typeof SECTIONS)[number];

/** Главная is the default section, so an unknown path lands there rather than nowhere. */
const DEFAULT_INDEX = 1;

/**
 * Resolves a URL path to its section, or null when the path is not part of the swipe deck at all
 * (`/dev/kitchen-sink`). Longest prefix wins, so `/profile/admin` stays on Профиль. `/` is excluded
 * from prefix matching — it prefixes every path — and matches only exactly.
 */
export function sectionOfPath(pathname: string): Section | null {
	let best: Section | null = null;

	for (const section of SECTIONS) {
		if (section.href === '/') {
			if (pathname === '/') return section;
			continue;
		}
		if (pathname === section.href || pathname.startsWith(`${section.href}/`)) {
			if (!best || section.href.length > best.href.length) best = section;
		}
	}

	return best;
}

/** Maps a URL path to its section index, falling back to Главная for anything unrecognised. */
export function indexOfPath(pathname: string): number {
	return sectionOfPath(pathname)?.index ?? DEFAULT_INDEX;
}
