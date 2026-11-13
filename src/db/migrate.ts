import fs from 'node:fs';
import path from 'node:path';
import { getEnv } from '@/lib/env';
import { createDbClient } from './index';

/**
 * Applies all SQL migrations in `./drizzle/` sequentially and idempotently.
 */
export async function applyMigrations(databaseUrl?: string): Promise<void> {
  const url = databaseUrl || getEnv().DATABASE_URL;
  const migrationsDir = path.resolve(process.cwd(), 'drizzle');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const client = createDbClient(url);
  try {
    if (url.includes('samiti_test')) {
      await client.executeRaw('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO PUBLIC;');
    }

    await client.executeRaw(`
      CREATE TABLE IF NOT EXISTS __samiti_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const appliedRows = await client.queryRaw<{ name: string }>(
      'SELECT name FROM __samiti_migrations'
    );
    const applied = new Set(appliedRows.map((r) => r.name));

    for (const file of files) {
      if (applied.has(file)) continue;
      const fullPath = path.join(migrationsDir, file);
      const sqlText = fs.readFileSync(fullPath, 'utf8');
      await client.executeRaw('BEGIN');
      try {
        await client.executeRaw(sqlText);
        await client.queryRaw('INSERT INTO __samiti_migrations (name) VALUES ($1)', [file]);
        await client.executeRaw('COMMIT');
      } catch (err) {
        await client.executeRaw('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.close();
  }
}
