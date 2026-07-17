import { defineConfig } from 'drizzle-kit';

// Scripts and drizzle-kit run outside Vite, so $env is unavailable here.
const url = process.env.DATABASE_PATH ?? './data/app.db';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: { url },
	strict: true,
	verbose: true
});
