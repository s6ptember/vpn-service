import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: { command: 'npm run build && npm run preview', port: 4173 },
	testMatch: '**/*.e2e.{ts,js}',
	/**
	 * One worker, so the files run in name order and never overlap.
	 *
	 * The suite shares two things the app deliberately keeps global: one SQLite file (tech.md 3 —
	 * exactly one replica) and one per-IP budget for the initData exchange, since every test comes
	 * from 127.0.0.1. Parallel files would let one suite's writes and refusals land inside another's
	 * assertions. stage9-rate-limit.e2e.ts sorts last for the same reason: it spends the budget.
	 */
	workers: 1
});
