import { dev } from '$app/environment';
import { SessionService } from './auth/session';
import { FakeMarzban, MarzbanHttp, type MarzbanApi } from './clients/marzban';
import { FakePayments, StripePayments, type PaymentProvider } from './clients/payments';
import { FakeTelegram, TelegramHttp, type TelegramApi } from './clients/telegram';
import { config } from './config';
import { db } from './db';
import { TelegramSendMessageHandler } from './jobs/handlers/telegram-send-message';
import { JobQueue } from './jobs/queue';
import { JobWorker } from './jobs/worker';
import { log } from './log';
import { PlanService } from './plans';

/**
 * Composition root: the ONE place that picks an implementation. Nothing below imports a sibling
 * singleton, so every domain class stays constructible in a test with fakes.
 *
 * These singletons are safe because they are stateless services plus one DB handle. Anything
 * request-scoped (the current user) rides event.locals and never lands in a module variable.
 */

// Empty MARZBAN_API_URL selects the fake, per tech.md 8. Dev never needs a live panel.
const marzban: MarzbanApi = config.MARZBAN_API_URL
	? new MarzbanHttp({
			baseUrl: config.MARZBAN_API_URL,
			username: config.MARZBAN_ADMIN_USERNAME,
			password: config.MARZBAN_ADMIN_PASSWORD,
			inboundTags: config.MARZBAN_INBOUND_TAGS,
			vlessFlow: config.MARZBAN_VLESS_FLOW,
			subUrlPrefix: config.MARZBAN_SUB_URL_PREFIX
		})
	: new FakeMarzban();

// tech.md names no env switch for Telegram, so dev gets the fake: a developer must not need a bot,
// and a placeholder token would otherwise send real API calls into the void.
const telegram: TelegramApi = dev
	? new FakeTelegram()
	: new TelegramHttp({ botToken: config.TELEGRAM_BOT_TOKEN });

const payments: PaymentProvider =
	config.PAYMENT_PROVIDER === 'stripe'
		? new StripePayments({
				secretKey: config.STRIPE_SECRET_KEY,
				webhookSecret: config.STRIPE_WEBHOOK_SECRET,
				priceCurrency: config.PRICE_CURRENCY,
				returnDeeplink: config.RETURN_DEEPLINK
			})
		: new FakePayments();

export const clients = { marzban, telegram, payments };

export const sessions = new SessionService(db, {
	secret: config.SESSION_SECRET,
	ttlDays: config.SESSION_TTL_DAYS,
	adminChatId: config.ADMIN_CHAT_ID
});

export const plans = new PlanService(db);

export const jobs = new JobQueue(db);

const worker = new JobWorker(jobs, [new TelegramSendMessageHandler(telegram, log)], log, {
	adminChatId: config.ADMIN_CHAT_ID
});

/**
 * One process, one worker (tech.md 3: exactly one replica, SQLite plus an in-process worker).
 * Started from hooks.server.ts so importing the container in a test never spawns a timer.
 */
export function startWorker(): void {
	worker.start();
}

export function stopWorker(): void {
	worker.stop();
}
