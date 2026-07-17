export type SubscriptionStatus = 'active' | 'expired' | 'revoked';

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
	'active',
	'expired',
	'revoked'
] as const;

export interface SubscriptionDTO {
	planName: string;
	status: SubscriptionStatus;
	expiresAt: number;
	daysLeft: number;
	subscriptionUrl: string; // owner only
}
