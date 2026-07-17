import type { Currency } from './money';

export interface PlanDTO {
	id: number;
	name: string;
	description: string | null;
	durationDays: number;
	priceMinor: number; // cents
	currency: Currency;
	trafficLimitBytes: number; // 0 = unlimited
	isActive: boolean;
	sortOrder: number;
}

export type PlanSnapshot = Pick<
	PlanDTO,
	'name' | 'durationDays' | 'priceMinor' | 'currency' | 'trafficLimitBytes'
>;
