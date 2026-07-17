import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '../src/lib/server/db/client';

// Scripts run outside Vite, so nothing has loaded .env for them and the documented quickstart would
// die on a fresh clone. In Docker the values arrive through env_file and no .env exists — hence the
// tolerated miss rather than a hard failure.
try {
	process.loadEnvFile('.env');
} catch {
	// No .env: fall back to the real environment (docker, CI).
}

// Runs as the app-migrate one-shot, before app boots. Never two migrators on one SQLite file.
const path = process.env.DATABASE_PATH;
if (!path) {
	console.error('DATABASE_PATH is required');
	process.exit(1);
}

mkdirSync(dirname(path), { recursive: true });

const db = createDb(path);
migrate(db, { migrationsFolder: './drizzle' });
console.log(`migrations applied: ${path}`);
