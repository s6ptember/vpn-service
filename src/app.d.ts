import type { SessionUser } from '$lib/types';

declare global {
	namespace App {
		interface Error {
			code: string;
			message: string;
			requestId: string;
		}
		interface Locals {
			user: SessionUser | null;
			requestId: string;
		}
	}
}

export {};
