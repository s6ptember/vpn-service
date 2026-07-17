import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDb } from '../src/lib/server/db/client';

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
