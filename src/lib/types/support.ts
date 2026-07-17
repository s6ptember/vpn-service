export interface FaqItemDTO {
	id: number;
	question: string;
	answer: string;
}

export type TicketStatus = 'new' | 'delivered' | 'failed';

export const TICKET_STATUSES: readonly TicketStatus[] = ['new', 'delivered', 'failed'] as const;

export const TICKET_MESSAGE_MIN = 10;
export const TICKET_MESSAGE_MAX = 2000;
