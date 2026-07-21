import { gibFromBytes } from './plan-value';

/**
 * Presentation only, beside the route for the reason plan-value.ts is (CLAUDE.md 3): nothing here
 * decides anybody's access, only how the current plan card reads.
 *
 * `usedBytes` is null in two cases the card must not conflate: nobody has a subscription at all, and
 * Marzban could not answer in time (subscription-reader.ts reads it best-effort). Either way there is
 * a number to fall back to — the day the panel comes back, the card starts showing it again with no
 * code change.
 */
export function formatTrafficUsage(usedBytes: number | null, limitBytes: number): string {
	if (usedBytes === null) {
		return limitBytes === 0 ? 'Безлимитный трафик' : `Лимит ${gibFromBytes(limitBytes)} ГБ`;
	}

	const used = gibFromBytes(usedBytes);
	return limitBytes === 0
		? `Использовано ${used} ГБ · безлимит`
		: `Использовано ${used} из ${gibFromBytes(limitBytes)} ГБ`;
}

/** Share of the limit spent, clamped to [0, 1]. Null with an unlimited plan: there is no bar to draw. */
export function trafficUsageRatio(usedBytes: number | null, limitBytes: number): number | null {
	if (usedBytes === null || limitBytes === 0) return null;
	return Math.min(1, Math.max(0, usedBytes / limitBytes));
}
