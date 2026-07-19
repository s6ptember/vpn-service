import { CURRENCIES, type Currency, type OrderDTO } from '$lib/types';
import { ConfigError } from '../errors';
import type { OrderRow } from '../db/schema';

/**
 * Row -> DTO in the domain, never hand-rolled in a +page.server.ts (CLAUDE.md 1.4). It matters more
 * on `orders` than anywhere else so far: the row carries providerPaymentIntentId and
 * providerSessionId, and neither has any business leaving the server.
 */
export function toOrderDTO(row: OrderRow): OrderDTO {
	return {
		id: row.id,
		// The snapshot, not the live plan: the receipt describes what was bought, not what the plan
		// has been renamed or repriced to since.
		plan: row.planSnapshot,
		status: row.status,
		finalPriceMinor: row.finalPriceMinor,
		currency: currencyOf(row.currency),
		createdAt: row.createdAt.getTime(),
		paidAt: row.paidAt?.getTime() ?? null
	};
}

/**
 * `orders.currency` is free text in the schema (tech.md 5) while the DTO wants the frozen union.
 * We are the only writer, so a value outside it means the row was edited by hand or written by a
 * build that knew a currency this one does not — a wiring fault, not a customer's mistake, and it
 * must not be laundered into the union with a cast.
 */
function currencyOf(value: string): Currency {
	const currency = CURRENCIES.find((known) => known === value);
	if (!currency) throw new ConfigError(`order carries unsupported currency ${value}`);
	return currency;
}
