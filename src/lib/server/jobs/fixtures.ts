import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from '$lib/server/db/client';
import type { Logger } from '$lib/server/log';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../../drizzle', import.meta.url));

/**
 * A real SQLite with the real migrations. Job tests are about a unique index, BEGIN IMMEDIATE and
 * a status column: a stubbed db would assert nothing about any of them.
 */
export function createTestDb(): Db {
	const db = createDb(':memory:');
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return db;
}

/** Time is a parameter everywhere in this codebase (CLAUDE.md 3), so no test ever sleeps. */
export class TestClock {
	constructor(private ms: number = 1_700_000_000_000) {}

	now = (): number => this.ms;

	advance(ms: number): void {
		this.ms += ms;
	}
}

export function silentLogger(): Logger {
	const logger: Logger = {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
		child: () => logger
	};
	return logger;
}
