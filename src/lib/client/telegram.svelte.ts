import { invalidateAll } from '$app/navigation';
import type { SessionUser } from '$lib/types';
import { toasts } from '$lib/ui/toasts.svelte';
import { webApp } from './telegram-webapp';

/** Page background pushed to the Telegram chrome so the app and the client agree (vpn-miniapp.html). */
const PAGE_COLOR = '#F2F2F6';

const AUTH_ENDPOINT = '/api/auth/telegram';

/**
 * Client-side session state. A class with runes in fields, handed down through context — never a
 * module-level mutable export, so nothing here can be mistaken for shared server state.
 *
 * `user` is a getter over the layout's `data.user`, not a copied $state field: the server load is
 * the single source of truth, and mirroring it into local state would need an $effect to stay in
 * sync — exactly the pattern CLAUDE.md 1.1 forbids.
 */
export class TelegramSession {
	/** False until the Telegram handshake settles. The layout holds a splash over the app until then. */
	ready = $state(false);

	readonly #readUser: () => SessionUser | null;
	#started = false;

	constructor(readUser: () => SessionUser | null) {
		this.#readUser = readUser;
	}

	get user(): SessionUser | null {
		return this.#readUser();
	}

	get isAdmin(): boolean {
		return this.user?.isAdmin ?? false;
	}

	/** Called from a $effect in the layout: this is genuinely the world outside Svelte. */
	async init(): Promise<void> {
		// The handshake costs a round trip and a write; an effect that re-runs must not repeat it.
		if (this.#started) return;
		this.#started = true;

		const tg = webApp();

		if (!tg) {
			// Opened in a plain browser (dev, kitchen sink). Nothing to hand shake with.
			this.ready = true;
			return;
		}

		tg.ready();
		tg.expand?.();
		// Without this the vertical component of a horizontal swipe collapses the mini app mid-gesture.
		tg.disableVerticalSwipes?.();
		tg.setHeaderColor?.(PAGE_COLOR);
		tg.setBackgroundColor?.(PAGE_COLOR);

		try {
			await this.#exchange(tg.initData);
		} finally {
			// The splash lifts either way: a person who could not be signed in still gets the app,
			// the plans and a profile that says how to get in — not a spinner forever.
			this.ready = true;
		}
	}

	/**
	 * Swaps initData for the session cookie (tech.md 9). It runs on every start, not only when
	 * signed out: step 4 refreshes the stored name, @username and avatar, and those are exactly the
	 * fields people change between two visits.
	 */
	async #exchange(rawInitData: string): Promise<void> {
		if (!rawInitData) return;

		// Captured before the round trip: only a session that appears out of nothing needs the
		// loads re-run. Re-running them on every start would fetch the same page data twice.
		const wasSignedOut = this.user === null;

		let response: Response;
		try {
			response = await fetch(AUTH_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ initData: rawInitData })
			});
		} catch {
			// Offline or the app is unreachable. An existing cookie still works, so say what is
			// wrong rather than tearing the session down.
			toasts.push('Нет связи с сервером. Проверьте интернет и откройте приложение заново.', 'danger');
			return;
		}

		if (!response.ok) {
			if (wasSignedOut) toasts.push(await messageOf(response), 'danger');
			return;
		}

		if (wasSignedOut) await invalidateAll();
	}
}

/** The server sends a human-readable sentence with every refusal; fall back if it did not. */
async function messageOf(response: Response): Promise<string> {
	try {
		const body: unknown = await response.json();
		if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
			return body.message;
		}
	} catch {
		// A refusal without a JSON body is still a refusal.
	}
	return 'Не удалось войти. Откройте приложение из Telegram заново.';
}

export const TELEGRAM_SESSION_KEY = Symbol('telegram-session');
