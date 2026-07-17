import type { SessionUser } from '$lib/types';
import { webApp } from './telegram-webapp';

/** Page background pushed to the Telegram chrome so the app and the client agree (vpn-miniapp.html). */
const PAGE_COLOR = '#F2F2F6';

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
	init(): void {
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

		// A1 exchanges tg.initData for a session cookie here and calls invalidateAll() before
		// flipping ready, which is what makes tech.md 9's "no half-empty profile" splash exact.
		this.ready = true;
	}
}

export const TELEGRAM_SESSION_KEY = Symbol('telegram-session');
