import * as v from 'valibot';
import {
	ADMIN_CHAT_ID,
	DATABASE_PATH,
	INIT_DATA_MAX_AGE_SEC,
	MARZBAN_ADMIN_PASSWORD,
	MARZBAN_ADMIN_USERNAME,
	MARZBAN_API_URL,
	MARZBAN_INBOUND_TAGS,
	MARZBAN_SUB_URL_PREFIX,
	MARZBAN_VLESS_FLOW,
	PAYMENT_PROVIDER,
	PRICE_CURRENCY,
	RETURN_DEEPLINK,
	SESSION_SECRET,
	SESSION_TTL_DAYS,
	STRIPE_SECRET_KEY,
	STRIPE_WEBHOOK_SECRET,
	TELEGRAM_BOT_TOKEN,
	TELEGRAM_BOT_USERNAME,
	TELEGRAM_WEBHOOK_SECRET
} from '$env/static/private';
import { PUBLIC_APP_URL } from '$env/static/public';
import { CURRENCIES } from '$lib/types';

const trimmed = v.pipe(v.string(), v.trim());
const required = (name: string) => v.pipe(trimmed, v.minLength(1, `${name} is required`));

const intFrom = (name: string, min: number, max: number) =>
	v.pipe(
		trimmed,
		v.regex(/^-?\d+$/, `${name} must be an integer`),
		v.transform(Number),
		v.integer(),
		v.minValue(min, `${name} must be >= ${min}`),
		v.maxValue(max, `${name} must be <= ${max}`)
	);

const url = (name: string) => v.pipe(required(name), v.url(`${name} must be an absolute URL`));

const ConfigSchema = v.pipe(
	v.object({
		PUBLIC_APP_URL: url('PUBLIC_APP_URL'),
		DATABASE_PATH: required('DATABASE_PATH'),
		// 32 bytes hex. Short secret means a forgeable session cookie, so this is a hard floor.
		SESSION_SECRET: v.pipe(required('SESSION_SECRET'), v.minLength(32, 'SESSION_SECRET is too short')),
		SESSION_TTL_DAYS: intFrom('SESSION_TTL_DAYS', 1, 365),

		TELEGRAM_BOT_TOKEN: required('TELEGRAM_BOT_TOKEN'),
		TELEGRAM_BOT_USERNAME: required('TELEGRAM_BOT_USERNAME'),
		TELEGRAM_WEBHOOK_SECRET: required('TELEGRAM_WEBHOOK_SECRET'),
		ADMIN_CHAT_ID: intFrom('ADMIN_CHAT_ID', 1, Number.MAX_SAFE_INTEGER),
		INIT_DATA_MAX_AGE_SEC: intFrom('INIT_DATA_MAX_AGE_SEC', 60, 604800),

		// Empty in dev: container.ts falls back to FakeMarzban.
		MARZBAN_API_URL: v.pipe(trimmed, v.union([v.literal(''), v.pipe(v.string(), v.url())])),
		MARZBAN_ADMIN_USERNAME: trimmed,
		MARZBAN_ADMIN_PASSWORD: trimmed,
		MARZBAN_INBOUND_TAGS: v.pipe(
			required('MARZBAN_INBOUND_TAGS'),
			v.transform((s) => s.split(',').map((tag) => tag.trim()).filter(Boolean)),
			v.minLength(1, 'MARZBAN_INBOUND_TAGS must list at least one tag')
		),
		MARZBAN_VLESS_FLOW: required('MARZBAN_VLESS_FLOW'),
		MARZBAN_SUB_URL_PREFIX: url('MARZBAN_SUB_URL_PREFIX'),

		PAYMENT_PROVIDER: v.picklist(['stripe', 'fake'] as const),
		STRIPE_SECRET_KEY: trimmed,
		STRIPE_WEBHOOK_SECRET: trimmed,
		PRICE_CURRENCY: v.picklist(CURRENCIES),
		RETURN_DEEPLINK: url('RETURN_DEEPLINK')
	}),
	// Stripe keys are only mandatory once the real provider is selected; dev runs on fakes.
	v.forward(
		v.check(
			(c) => c.PAYMENT_PROVIDER !== 'stripe' || c.STRIPE_SECRET_KEY.length > 0,
			'STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe'
		),
		['STRIPE_SECRET_KEY']
	),
	v.forward(
		v.check(
			(c) => c.PAYMENT_PROVIDER !== 'stripe' || c.STRIPE_WEBHOOK_SECRET.length > 0,
			'STRIPE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=stripe'
		),
		['STRIPE_WEBHOOK_SECRET']
	),
	v.forward(
		v.check(
			(c) => c.MARZBAN_API_URL === '' || c.MARZBAN_ADMIN_USERNAME.length > 0,
			'MARZBAN_ADMIN_USERNAME is required when MARZBAN_API_URL is set'
		),
		['MARZBAN_ADMIN_USERNAME']
	),
	v.forward(
		v.check(
			(c) => c.MARZBAN_API_URL === '' || c.MARZBAN_ADMIN_PASSWORD.length > 0,
			'MARZBAN_ADMIN_PASSWORD is required when MARZBAN_API_URL is set'
		),
		['MARZBAN_ADMIN_PASSWORD']
	)
);

export type Config = v.InferOutput<typeof ConfigSchema>;

function load(): Config {
	const result = v.safeParse(ConfigSchema, {
		PUBLIC_APP_URL,
		DATABASE_PATH,
		SESSION_SECRET,
		SESSION_TTL_DAYS,
		TELEGRAM_BOT_TOKEN,
		TELEGRAM_BOT_USERNAME,
		TELEGRAM_WEBHOOK_SECRET,
		ADMIN_CHAT_ID,
		INIT_DATA_MAX_AGE_SEC,
		MARZBAN_API_URL,
		MARZBAN_ADMIN_USERNAME,
		MARZBAN_ADMIN_PASSWORD,
		MARZBAN_INBOUND_TAGS,
		MARZBAN_VLESS_FLOW,
		MARZBAN_SUB_URL_PREFIX,
		PAYMENT_PROVIDER,
		STRIPE_SECRET_KEY,
		STRIPE_WEBHOOK_SECRET,
		PRICE_CURRENCY,
		RETURN_DEEPLINK
	});

	if (!result.success) {
		// Names and reasons only: values are secrets and must never reach the log.
		const lines = result.issues.map((issue) => {
			const key = issue.path?.map((p) => String(p.key)).join('.') ?? '(root)';
			return `  ${key}: ${issue.message}`;
		});
		throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
	}

	return result.output;
}

export const config: Config = load();
