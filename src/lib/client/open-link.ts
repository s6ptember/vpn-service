import { webApp } from './telegram-webapp';

/**
 * Opens a page OUTSIDE the mini app (tech.md 10). Stripe's hosted checkout has to run in a real
 * browser: 3DS, Apple Pay and Google Pay are not guaranteed to work inside a Telegram WebView, and
 * `openInvoice` only understands Telegram's own invoices.
 *
 * `WebApp.openLink` keeps the mini app open behind the browser, which is what makes the
 * "Ждём оплату" screen possible at all. Outside Telegram — a plain browser, a test — there is no
 * bridge, so a new tab is the honest fallback.
 */
export function openExternal(url: string): boolean {
	const tg = webApp();

	if (tg?.openLink) {
		tg.openLink(url);
		return true;
	}

	// noopener: the payment page must never get a handle on the window that opened it.
	return window.open(url, '_blank', 'noopener') !== null;
}
