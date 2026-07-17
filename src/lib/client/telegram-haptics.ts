import { webApp, type HapticStyle } from './telegram-webapp';

export type { HapticStyle };

/**
 * Haptics are decoration: outside Telegram there is no bridge, and an old client can reject the call
 * outright. Every hop is optional-chained and the call is wrapped, so a missing or angry bridge can
 * never take navigation down with it. No-ops in a plain browser, in SSR and in tests.
 */
export function haptic(style: HapticStyle = 'light'): void {
	try {
		webApp()?.HapticFeedback?.impactOccurred?.(style);
	} catch {
		// Nothing to recover and nothing worth logging: the tap already did its real work.
	}
}
