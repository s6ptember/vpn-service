export type Currency = 'usd' | 'eur'; // ISO 4217 lowercase, Stripe format

export const CURRENCIES: readonly Currency[] = ['usd', 'eur'] as const;

/**
 * Stripe declines charges below this. No order is ever created under it,
 * and a discount that would dip below it clamps to it rather than to zero.
 */
export const MIN_CHARGE_MINOR: Record<Currency, number> = { usd: 50, eur: 50 };
