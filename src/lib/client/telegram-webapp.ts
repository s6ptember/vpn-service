/**
 * Narrow hand-written surface of the Telegram WebApp API. There is no official types package, and
 * `any` is banned — so we declare exactly the members we use and nothing more. Every one of them is
 * optional: Telegram ships new methods over time and old clients simply lack them, so callers must
 * treat each as "may not exist" rather than trusting the version string.
 */
export interface TelegramWebAppUser {
	id: number;
	first_name: string;
	last_name?: string;
	username?: string;
	photo_url?: string;
	language_code?: string;
}

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

export interface TelegramWebApp {
	initData: string;
	initDataUnsafe?: { user?: TelegramWebAppUser; start_param?: string };
	ready(): void;
	expand?(): void;
	disableVerticalSwipes?(): void;
	setHeaderColor?(color: string): void;
	setBackgroundColor?(color: string): void;
	openLink?(url: string, options?: { try_instant_view?: boolean }): void;
	HapticFeedback?: {
		impactOccurred?(style: HapticStyle): void;
		notificationOccurred?(type: 'error' | 'success' | 'warning'): void;
	};
}

declare global {
	interface Window {
		Telegram?: { WebApp?: TelegramWebApp };
	}
}

export const webApp = (): TelegramWebApp | null =>
	typeof window === 'undefined' ? null : (window.Telegram?.WebApp ?? null);
