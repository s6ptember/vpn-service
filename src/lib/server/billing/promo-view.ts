import type { DiscountType } from '$lib/types';
import type { PromoCodeRow } from '../db/schema';

/**
 * What the admin screen needs to see about a promo code (A11).
 *
 * ## Why this type exists at all
 *
 * `PromoCodeDTO` (tech.md 7) carries id, code, discountType and discountValue — everything a
 * customer's price needs and nothing an admin can manage with. The screen tech.md 11 asks for has to
 * show and edit the usage budget, the validity window and the active flag, none of which are in that
 * DTO, and `lib/types` is the lead's (tech.md 15). So this is the local stub CLAUDE.md 0 prescribes
 * while the CONTRACT GAP for a `PromoAdminDTO` is open — it lives in the domain that owns promo
 * codes, is never returned to a customer-facing route, and is meant to be deleted the day the
 * contract lands.
 *
 * Dates leave as milliseconds, like every other DTO in this project: a Date would be serialised to
 * an ISO string on the way to the page anyway, and the page would have to parse it back.
 */
export interface PromoAdminView {
	id: number;
	code: string;
	discountType: DiscountType;
	discountValue: number;
	/** null = unlimited (tech.md 5). */
	maxUses: number | null;
	usedCount: number;
	validFrom: number | null;
	validUntil: number | null;
	isActive: boolean;
}

/** Row -> view in the domain, never hand-rolled in a +page.server.ts (CLAUDE.md 1.4). */
export function toPromoAdminView(row: PromoCodeRow): PromoAdminView {
	return {
		id: row.id,
		code: row.code,
		discountType: row.discountType,
		discountValue: row.discountValue,
		maxUses: row.maxUses,
		usedCount: row.usedCount,
		validFrom: row.validFrom?.getTime() ?? null,
		validUntil: row.validUntil?.getTime() ?? null,
		isActive: row.isActive
	};
}
