import type { TicketStatus } from '$lib/types';
import type { SupportTicketRow, UserRow } from '../db/schema';

/**
 * What the admin screen needs to see about a support request (A16).
 *
 * ## Why this type exists at all
 *
 * `lib/types/support.ts` carries `FaqItemDTO`, `TicketStatus` and the length bounds — everything the
 * public support screen needs and nothing an admin can triage with. tech.md 11 asks the panel for a
 * list of recent requests, and `lib/types` is the lead's (tech.md 15). So this is the local stub
 * CLAUDE.md 0 prescribes while the CONTRACT GAP for a `TicketDTO` is open, on the model of
 * `billing/promo-view.ts`, and it is meant to be deleted the day the contract lands.
 *
 * ## Why an excerpt and not the message
 *
 * The full text already went where it was addressed: `support.notify_admin` relays it into the
 * admin's private chat, which is the delivery this feature promises. Rendering it again on a page
 * makes a second copy of somebody's private description of their problem, in a place that is
 * screenshotted, scrolled past in public and cached by a browser. The list is here to answer "did
 * these arrive, and which ones failed" — a first line is enough to recognise a request by, and the
 * status column is the part that actually needs reading.
 */
export interface TicketAdminView {
	id: number;
	status: TicketStatus;
	createdAt: number;
	deliveredAt: number | null;
	/** How to reach the person back, in the form the admin already sees in the relayed message. */
	author: {
		telegramId: number;
		username: string | null;
		name: string;
	};
	excerpt: string;
}

/** Enough to recognise a request by, not enough to be a second copy of it. */
const EXCERPT_MAX = 120;

/** Row -> view in the domain, never hand-rolled in a +page.server.ts (CLAUDE.md 1.4). */
export function toTicketAdminView(row: SupportTicketRow, author: UserRow): TicketAdminView {
	return {
		id: row.id,
		status: row.status,
		createdAt: row.createdAt.getTime(),
		deliveredAt: row.deliveredAt?.getTime() ?? null,
		author: {
			telegramId: author.telegramId,
			username: author.username,
			name: [author.firstName, author.lastName].filter(Boolean).join(' ')
		},
		excerpt: excerpt(row.message)
	};
}

/** Cut on the character, with an ellipsis that says the text goes on. */
function excerpt(message: string): string {
	const trimmed = message.trim();
	return trimmed.length <= EXCERPT_MAX ? trimmed : `${trimmed.slice(0, EXCERPT_MAX).trimEnd()}…`;
}
