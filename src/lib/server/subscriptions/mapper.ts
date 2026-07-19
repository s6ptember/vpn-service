import type { SubscriptionDTO } from '$lib/types';
import type { SubscriptionRow } from '../db/schema';
import { daysLeft, isActiveAt } from './expiry';

/**
 * Row -> DTO in the domain (CLAUDE.md 1.4). The row carries `marzbanUsername`, which tech.md 1.4
 * names as a thing that must not leave the server — this mapper is what guarantees it never does.
 *
 * `subscriptionUrl` DOES go out, and only to its owner (tech.md 7): that link is the key itself,
 * so every load that calls this must already have decided the reader is the person it belongs to.
 */
export function toSubscriptionDTO(
	row: SubscriptionRow,
	planName: string,
	nowMs: number
): SubscriptionDTO {
	const expiresAt = row.expiresAt.getTime();

	return {
		planName,
		/**
		 * A date the app can read beats a flag somebody has to remember to update. `subscription.sweep`
		 * flips the stored status every five minutes, so between the moment access lapses and the next
		 * sweep the column says `active` while the VPN has already stopped. A revoked subscription is
		 * a decision, not a date, so it survives the recalculation.
		 */
		status:
			row.status === 'revoked' ? 'revoked' : isActiveAt(expiresAt, nowMs) ? 'active' : 'expired',
		expiresAt,
		daysLeft: daysLeft(expiresAt, nowMs),
		subscriptionUrl: row.subscriptionUrl
	};
}
