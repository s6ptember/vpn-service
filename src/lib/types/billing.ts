import type { Currency } from './money';
import type { PlanSnapshot } from './plan';

export interface PriceQuote {
	basePriceMinor: number;
	discountMinor: number;
	finalPriceMinor: number;
	currency: Currency;
	promoCode: string | null;
}

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'canceled';

export const ORDER_STATUSES: readonly OrderStatus[] = [
	'pending',
	'paid',
	'failed',
	'canceled'
] as const;

export interface OrderDTO {
	id: number;
	plan: PlanSnapshot;
	status: OrderStatus;
	finalPriceMinor: number;
	currency: Currency;
	createdAt: number;
	paidAt: number | null;
}

export type DiscountType = 'percent' | 'fixed';

export interface PromoCodeDTO {
	id: number;
	code: string;
	discountType: DiscountType;
	discountValue: number;
}

export type PromoError = 'not_found' | 'inactive' | 'expired' | 'exhausted' | 'already_used';
