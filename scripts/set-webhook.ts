/**
 * Points Telegram at this deployment's webhook (tech.md 9). Run once per environment, and again
 * whenever the domain or TELEGRAM_WEBHOOK_SECRET changes.
 *
 * Separate from the deploy rather than part of it: Telegram validates the TLS certificate when it
 * registers a webhook, so this cannot succeed until DNS resolves and Caddy has finished its first
 * ACME order. Wiring it into `docker compose up` would make a first deploy fail on a race it has no
 * way to win.
 *
 *   docker compose --profile webhook up app-set-webhook   # on the VPS
 *   npm run tg:set-webhook                                # locally, against a tunnel
 */

// Scripts run outside Vite, so nothing has loaded .env for them. In Docker the values arrive
// through env_file and no .env exists — hence the tolerated miss rather than a hard failure.
try {
	process.loadEnvFile('.env');
} catch {
	// No .env: fall back to the real environment (docker, CI).
}

const token = required('TELEGRAM_BOT_TOKEN');
const secret = required('TELEGRAM_WEBHOOK_SECRET');
const appUrl = required('PUBLIC_APP_URL').replace(/\/+$/, '');

// Telegram refuses to register a plain-HTTP webhook, and the failure it returns names the URL
// rather than the scheme. Say it here instead.
if (!appUrl.startsWith('https://')) {
	fail(`PUBLIC_APP_URL must be https for a webhook, got ${appUrl}`);
}

const webhookUrl = `${appUrl}/api/telegram/webhook`;

const setResult = await call('setWebhook', {
	url: webhookUrl,
	// The header the route checks. Telegram sends it on every delivery.
	secret_token: secret,
	/**
	 * The route answers `/start` and ignores everything else, so asking for anything more would be
	 * bandwidth spent to be discarded — and every update type left out is one this app can never be
	 * surprised by.
	 */
	allowed_updates: ['message'],
	/**
	 * Registration is also the moment a backlog would arrive: messages sent while no webhook existed
	 * are queued by Telegram and delivered in a burst. They are stale by definition — anyone still
	 * waiting can press the button again — so start from empty rather than answer a week of history.
	 */
	drop_pending_updates: true
});

console.log(`webhook set: ${webhookUrl} (${JSON.stringify(setResult)})`);

/**
 * The interesting half. setWebhook answering `true` only means Telegram accepted the URL; whether
 * deliveries actually land shows up here as `last_error_message` — an expired certificate, a 401
 * from a secret that no longer matches, a domain that stopped resolving.
 */
const info = (await call('getWebhookInfo', {})) as {
	url?: string;
	pending_update_count?: number;
	last_error_date?: number;
	last_error_message?: string;
};

console.log(
	`webhook info: url=${info.url} pending=${info.pending_update_count ?? 0}` +
		(info.last_error_message
			? ` lastError="${info.last_error_message}" at ${new Date((info.last_error_date ?? 0) * 1000).toISOString()}`
			: ' lastError=none')
);

async function call(method: string, body: Record<string, unknown>): Promise<unknown> {
	const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10_000)
	});

	const payload = (await response.json().catch(() => null)) as {
		ok?: boolean;
		result?: unknown;
		description?: string;
	} | null;

	if (!response.ok || !payload?.ok) {
		// The token is in the URL, so the URL never reaches the message.
		fail(`${method} failed with ${response.status}: ${payload?.description ?? 'no description'}`);
	}

	return payload!.result;
}

function required(name: string): string {
	const value = process.env[name];
	if (!value) fail(`${name} is required`);
	return value!;
}

function fail(message: string): never {
	console.error(`set-webhook: ${message}`);
	process.exit(1);
}
