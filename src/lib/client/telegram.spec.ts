import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '$lib/types';
import { toasts } from '$lib/ui/toasts.svelte';
import { TelegramSession } from './telegram.svelte';
import type { TelegramWebApp } from './telegram-webapp';

/**
 * Derived from tech.md 9's flow, steps 1–6: the client hands the raw initData over, waits for the
 * cookie, then re-runs the loads so SSR renders signed in. What it must never do is hold the splash
 * over a failure, or send a person who is already signed in through a second full reload.
 */

const invalidateAll = vi.fn(async () => {});
vi.mock('$app/navigation', () => ({ invalidateAll: () => invalidateAll() }));

const RAW_INIT_DATA = 'user=%7B%22id%22%3A1%7D&auth_date=1700000000&hash=deadbeef';

const ALEX: SessionUser = {
	id: 1,
	telegramId: 555_000_111,
	username: 'alex_k',
	firstName: 'Александр',
	lastName: null,
	photoUrl: null,
	isAdmin: false
};

function fakeWebApp(overrides: Partial<TelegramWebApp> = {}): TelegramWebApp {
	return {
		initData: RAW_INIT_DATA,
		ready: vi.fn(),
		expand: vi.fn(),
		disableVerticalSwipes: vi.fn(),
		setHeaderColor: vi.fn(),
		setBackgroundColor: vi.fn(),
		...overrides
	};
}

/** The class reads window.Telegram through a helper; the helper reads the global. */
function install(tg: TelegramWebApp | null): void {
	if (tg) {
		vi.stubGlobal('window', { Telegram: { WebApp: tg } });
	} else {
		vi.stubGlobal('window', {});
	}
}

function respondWith(status: number, body: unknown = { ok: true }) {
	const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

beforeEach(() => {
	invalidateAll.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	for (const toast of [...toasts.items]) toasts.dismiss(toast.id);
});

describe('TelegramSession.init', () => {
	it('posts the raw initData string it was handed', async () => {
		install(fakeWebApp());
		const fetchMock = respondWith(200);

		await new TelegramSession(() => null).init();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/auth/telegram');
		expect(JSON.parse(String(options.body))).toEqual({ initData: RAW_INIT_DATA });
	});

	it('re-runs the loads once the cookie lands, so SSR renders signed in', async () => {
		install(fakeWebApp());
		respondWith(200);

		await new TelegramSession(() => null).init();

		expect(invalidateAll).toHaveBeenCalledTimes(1);
	});

	it('lifts the splash after the handshake', async () => {
		install(fakeWebApp());
		respondWith(200);

		const session = new TelegramSession(() => null);
		expect(session.ready).toBe(false);

		await session.init();
		expect(session.ready).toBe(true);
	});

	it('lifts the splash even when the exchange is refused', async () => {
		// A person who cannot be signed in still gets the app, not a spinner forever.
		install(fakeWebApp());
		respondWith(401, { code: 'auth_bad_signature', message: 'Не удалось подтвердить вход.' });

		const session = new TelegramSession(() => null);
		await session.init();

		expect(session.ready).toBe(true);
		expect(invalidateAll).not.toHaveBeenCalled();
	});

	it('says what went wrong when the exchange is refused', async () => {
		install(fakeWebApp());
		respondWith(401, { code: 'auth_bad_signature', message: 'Не удалось подтвердить вход.' });

		await new TelegramSession(() => null).init();

		expect(toasts.items.map((t) => t.message)).toEqual(['Не удалось подтвердить вход.']);
	});

	it('survives a network failure without tearing down an existing session', async () => {
		install(fakeWebApp());
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);

		const session = new TelegramSession(() => ALEX);
		await session.init();

		expect(session.ready).toBe(true);
		expect(session.user).toBe(ALEX);
		// Their cookie still works, so there is nothing for them to act on.
		expect(toasts.items).toEqual([]);
	});

	it('tells somebody stuck outside that the server is unreachable', async () => {
		install(fakeWebApp());
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);

		await new TelegramSession(() => null).init();

		expect(toasts.items).toHaveLength(1);
		expect(toasts.items[0].tone).toBe('danger');
	});

	it('still refreshes the stored profile when a session already exists', async () => {
		// tech.md 9.4: name, @username and photo are re-read on every login, because people change
		// them. Skipping the exchange for a signed-in visitor would freeze them for the cookie's TTL.
		install(fakeWebApp());
		const fetchMock = respondWith(200);

		await new TelegramSession(() => ALEX).init();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		// …but the loads already carry that user, so nothing needs re-running.
		expect(invalidateAll).not.toHaveBeenCalled();
	});

	it('does not nag a signed-in visitor about a failed refresh', async () => {
		install(fakeWebApp());
		respondWith(429, { code: 'rate_limit', message: 'Слишком много попыток.' });

		await new TelegramSession(() => ALEX).init();

		expect(toasts.items).toEqual([]);
	});

	it('runs the handshake once, however often the effect fires', async () => {
		install(fakeWebApp());
		const fetchMock = respondWith(200);

		const session = new TelegramSession(() => null);
		await Promise.all([session.init(), session.init()]);
		await session.init();

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does the Telegram handshake before anything else', async () => {
		const tg = fakeWebApp();
		install(tg);
		respondWith(200);

		await new TelegramSession(() => null).init();

		expect(tg.ready).toHaveBeenCalled();
		// Without this a horizontal swipe collapses the mini app mid-gesture (tech.md 11).
		expect(tg.disableVerticalSwipes).toHaveBeenCalled();
		expect(tg.setBackgroundColor).toHaveBeenCalledWith('#F2F2F6');
	});

	it('does nothing but settle when opened outside Telegram', async () => {
		install(null);
		const fetchMock = respondWith(200);

		const session = new TelegramSession(() => null);
		await session.init();

		expect(session.ready).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('skips the exchange when Telegram handed over an empty initData', async () => {
		// An old client, or the app opened from a link rather than the menu button.
		install(fakeWebApp({ initData: '' }));
		const fetchMock = respondWith(200);

		const session = new TelegramSession(() => null);
		await session.init();

		expect(fetchMock).not.toHaveBeenCalled();
		expect(session.ready).toBe(true);
	});

	it('reports admin from the server-signed session, never from Telegram', async () => {
		install(fakeWebApp());
		respondWith(200);

		const session = new TelegramSession(() => ({ ...ALEX, isAdmin: true }));
		await session.init();

		expect(session.isAdmin).toBe(true);
		expect(new TelegramSession(() => null).isAdmin).toBe(false);
	});
});
