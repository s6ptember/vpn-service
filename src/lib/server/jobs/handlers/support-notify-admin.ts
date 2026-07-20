import * as v from 'valibot';
import type { UserService } from '$lib/server/auth/user-service';
import { MAX_MESSAGE_LENGTH, type TelegramApi } from '$lib/server/clients/telegram';
import type { UserRow } from '$lib/server/db/schema';
import type { Logger } from '$lib/server/log';
import type { SupportTicketService } from '$lib/server/support';
import { JobHandler } from '../handler';

const PayloadSchema = v.object({ ticketId: v.number() });

export interface SupportNotifyAdminOptions {
	/**
	 * Where support lands. Injected, never read from config here, so the handler stays constructible
	 * in a test — the same rule its two sibling handlers follow.
	 */
	adminChatId: number;
}

/**
 * Relays one support request into the admin's Telegram (tech.md 6, A14).
 *
 * ## Idempotency
 *
 * Two runs of the same payload must leave exactly one effect, and this handler really is run twice:
 * a failed attempt is retried, and the worker deliberately re-runs a job that a dying process left
 * `running` (jobs/worker.ts, recoverOrphans).
 *
 * A delivered ticket carries the id of the message it produced, so `deliveredAt` is the proof that
 * the send already happened and the second run stops on it before reaching Telegram. The write that
 * follows a send carries the same condition in its WHERE clause, so even a run that somehow got past
 * the read cannot overwrite the id of the message the admin is looking at. Nothing here increments
 * or appends: the tenth run leaves exactly what the first did.
 *
 * That leaves one honest gap, the same one TelegramSendMessageHandler documents: a send that
 * succeeds at Telegram but fails on the way back is retried and the admin reads the request twice.
 * Bot API offers no idempotency key to close it with, and showing a support request twice beats
 * losing one.
 *
 * ## Why this does not go through telegram.send_message
 *
 * tech.md 6 gives this job its own row in the table with its own effect: send, AND write
 * `adminMessageId`. The generic message job returns nothing to its caller (it cannot — handlers
 * return no values), so the id that threads back to the delivered message would be lost.
 */
export class SupportNotifyAdminHandler extends JobHandler<'support.notify_admin'> {
	readonly type = 'support.notify_admin';
	readonly schema = PayloadSchema;

	private readonly adminChatId: number;

	constructor(
		private readonly tickets: SupportTicketService,
		private readonly users: UserService,
		private readonly telegram: TelegramApi,
		private readonly log: Logger,
		opts: SupportNotifyAdminOptions
	) {
		super();
		this.adminChatId = opts.adminChatId;
	}

	async handle(payload: v.InferOutput<typeof PayloadSchema>): Promise<void> {
		const ticket = this.tickets.findById(payload.ticketId);
		// Rows are never deleted here, so this is a payload that was never real. Retrying cannot
		// conjure the ticket, but throwing is still right: the queue records it and alerts the admin.
		if (!ticket) throw new Error(`support ticket ${payload.ticketId} is gone`);

		// The load-bearing idempotency guard: read the durable record of the effect before causing it.
		if (ticket.deliveredAt !== null) return;

		const author = this.users.findById(ticket.userId);
		if (!author) throw new Error(`support ticket ${ticket.id} belongs to a user that is gone`);

		try {
			const { messageId } = await this.telegram.sendMessage(
				this.adminChatId,
				this.#compose(ticket.id, author, ticket.message)
			);

			const { changed } = this.tickets.markDelivered(ticket.id, messageId);

			// Ids only. The message is somebody's private description of their problem and has no
			// business in stdout (CLAUDE.md 2).
			this.log.info(changed ? 'support_ticket_delivered' : 'support_ticket_delivered_twice', {
				ticketId: ticket.id,
				userId: author.id,
				messageId
			});
		} catch (error) {
			/**
			 * Recorded before the throw, so the row says what actually happened to the latest attempt
			 * instead of sitting at `new` forever while the queue quietly burns its five tries.
			 *
			 * The throw itself is what makes the retry happen: the queue owns the backoff (tech.md 6)
			 * and the worker alerts the admin once the attempts run out. Nothing is swallowed here —
			 * a support request that never arrives has to be loud.
			 */
			this.tickets.markFailed(ticket.id);
			throw error;
		}
	}

	/**
	 * Plain text, no parse_mode, deliberately: the body is typed by a stranger and the name comes
	 * from their Telegram profile. Under HTML or MarkdownV2 an unbalanced tag turns every support
	 * request into a 400 from Bot API — and a balanced one turns the relay into somebody else's
	 * formatting.
	 *
	 * Trimmed to what Bot API accepts (4096 characters). The header is measured rather than
	 * budgeted for: a name and a @username are as long as Telegram lets them be, and a constant
	 * guessed here would be a job that can never succeed the day somebody's profile outgrows it.
	 *
	 * The parser already caps a new message at 2000, so the trim only bites on a row written before
	 * that rule or edited by hand — and there it is the difference between a truncated request and a
	 * permanent 400 from Bot API.
	 */
	#compose(ticketId: number, author: UserRow, message: string): string {
		const name = [author.firstName, author.lastName].filter(Boolean).join(' ');
		const handle = author.username ? `@${author.username}` : `ID ${author.telegramId}`;
		const header = `Обращение #${ticketId}\nОт: ${name} (${handle})\n\n`;

		return `${header}${message}`.slice(0, MAX_MESSAGE_LENGTH);
	}
}
