import { error, type Handle, type HandleServerError } from '@sveltejs/kit';
import { building, dev } from '$app/environment';
import { sessions, startWorker } from '$lib/server/container';
import { log } from '$lib/server/log';

/**
 * Paths that arrive without a session by definition and carry their own signature instead
 * (tech.md 9). The guard skips them whole.
 */
const PUBLIC_PATHS = ['/api/auth/telegram', '/api/telegram/webhook', '/api/stripe/webhook'];

const isPublicPath = (pathname: string) => PUBLIC_PATHS.includes(pathname);
const isAdminPath = (pathname: string) => pathname.startsWith('/profile/admin');

// The kitchen sink documents primitives; it has no place in a production bundle.
const isDevOnlyPath = (pathname: string) => pathname.startsWith('/dev');

/**
 * SvelteKit routes on a decoded pathname but hands `handle` the raw one, so `/%64ev/kitchen-sink`
 * reaches the /dev route while `startsWith('/dev')` is false — every prefix check here would be one
 * percent-escape away from being skipped. Decoded exactly the way the router does it, '%25' left
 * alone so an encoded percent cannot decode twice.
 */
function decodePath(pathname: string): string {
	try {
		return pathname.split('%25').map(decodeURI).join('%25');
	} catch {
		// Malformed encoding never matches a route; keep it raw and let the router 404 it.
		return pathname;
	}
}

if (!building) {
	startWorker();
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();
	event.locals.user = sessions.read(event.cookies);

	const pathname = decodePath(event.url.pathname);

	if (isDevOnlyPath(pathname) && !dev) error(404, 'not found');

	if (!isPublicPath(pathname)) {
		/**
		 * The first document GET always arrives without a cookie: initData lives only in the client,
		 * so the shell renders first and swaps for a session afterwards. Guarding it would lock
		 * everyone out of the app. Mutations and API calls have no such excuse.
		 */
		const guarded = event.request.method !== 'GET' || pathname.startsWith('/api/');

		if (!event.locals.user && guarded) error(401, 'unauthorized');
		if (event.locals.user && isAdminPath(pathname) && !event.locals.user.isAdmin) {
			error(403, 'forbidden');
		}
	}

	const response = await resolve(event);

	// Telegram Web hosts the mini app in an iframe: X-Frame-Options or a narrower CSP kills it.
	// This header is set here and nowhere else — Caddy must not add one.
	response.headers.set(
		'content-security-policy',
		'frame-ancestors https://web.telegram.org https://*.telegram.org;'
	);
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');

	/**
	 * A17 — nothing in this app uses any of these, and a mini app runs inside somebody else's WebView
	 * where a permission prompt has no visible source. Denying them outright costs nothing and takes
	 * the whole class off the table.
	 *
	 * `payment=()` is safe despite the name: Stripe Checkout opens in the external browser
	 * (tech.md 10), not in this document, so the Payment Request API is never called here.
	 */
	response.headers.set(
		'permissions-policy',
		'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
	);

	/**
	 * A17 — a page rendered for a signed-in person carries their name, their subscription link and
	 * their purchase history. The subscription URL is the credential to the VPN itself, so a copy
	 * left in a shared or proxy cache is a leak, not a stale render.
	 *
	 * Narrow on purpose. It keys off the response actually being HTML rather than off the route, so
	 * hashed assets keep their long cache; and off `locals.user`, so the anonymous first render — the
	 * one every visitor gets before the cookie exists (tech.md 9) — stays cacheable.
	 */
	if (event.locals.user && response.headers.get('content-type')?.includes('text/html')) {
		response.headers.set('cache-control', 'no-store');
	}

	return response;
};

/**
 * Logs with the requestId and returns the safe shape. It deliberately does not set a status:
 * SvelteKit owns that, this only shapes App.Error.
 */
export const handleError: HandleServerError = ({ error: err, event, status, message }) => {
	const requestId = event.locals.requestId ?? 'unknown';

	// Stack traces and upstream messages stay in the log; the client gets a code and a sentence.
	log.error('unhandled_error', {
		requestId,
		status,
		path: event.url.pathname,
		error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err
	});

	return {
		code: status === 404 ? 'not_found' : 'internal_error',
		message: status === 404 ? message : 'Что-то сломалось. Попробуйте ещё раз.',
		requestId
	};
};
