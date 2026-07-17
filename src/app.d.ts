import type { SessionUser } from '$lib/types';

declare global {
	namespace App {
		/**
		 * handleError always fills code and requestId; they are optional only because SvelteKit types
		 * error(status, 'text') as `{message: string} extends App.Error ? … : never`. Making them
		 * required collapses that overload to never and breaks error(401, 'unauthorized') —
		 * the guard CLAUDE.md 1.3 prescribes verbatim.
		 */
		interface Error {
			message: string;
			code?: string;
			requestId?: string;
		}
		interface Locals {
			user: SessionUser | null;
			requestId: string;
		}
	}
}

export {};
