import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>;

/**
 * Single place opening a SQLite connection. Lives apart from index.ts so migrate/seed scripts,
 * which run outside Vite and cannot import $env, still get identical pragmas.
 */
export function createDb(path: string) {
	const sqlite = new Database(path);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('busy_timeout = 5000');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('synchronous = NORMAL');
	return drizzle(sqlite, { schema });
}
