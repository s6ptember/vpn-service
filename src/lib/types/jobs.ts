export interface JobMap {
	'subscription.provision': { orderId: number };
	'subscription.sweep': Record<string, never>;
	'subscription.notify_expiry': { subscriptionId: number; daysLeft: 3 | 1 };
	'support.notify_admin': { ticketId: number };
	'telegram.send_message': { chatId: number; text: string; dedupeKey: string };
	'marzban.reconcile': { subscriptionId: number };
}

export type JobType = keyof JobMap;

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export const JOB_STATUSES: readonly JobStatus[] = ['pending', 'running', 'done', 'failed'] as const;
