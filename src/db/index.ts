import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { getEnv } from '@/lib/env';

export type AppDb = NodePgDatabase<typeof schema>;

export interface DbClientHandle {
  db: AppDb;
  executeRaw: (sqlText: string) => Promise<unknown>;
  queryRaw: <T extends Record<string, unknown>>(sqlText: string, params?: unknown[]) => Promise<T[]>;
  close: () => Promise<void>;
}

interface GlobalDbState {
  __samitiDbHandle?: DbClientHandle | null;
  __samitiDbUrl?: string | null;
}

const globalForDb = globalThis as unknown as GlobalDbState;

function getCachedHandle(): DbClientHandle | null {
  return globalForDb.__samitiDbHandle ?? null;
}

function setCachedHandle(handle: DbClientHandle | null, url: string | null) {
  globalForDb.__samitiDbHandle = handle;
  globalForDb.__samitiDbUrl = url;
}

/**
 * Creates a fresh PostgreSQL or PGlite database client handle.
 */
export function createDbClient(databaseUrl: string): DbClientHandle {
  if (databaseUrl.startsWith('pglite://')) {
    const target = databaseUrl.slice('pglite://'.length);
    let client: PGlite;
    if (target === 'memory' || target === 'memory://') {
      client = new PGlite();
    } else {
      const resolved = path.resolve(target);
      fs.mkdirSync(resolved, { recursive: true });
      client = new PGlite(resolved);
    }
    const rawDb = drizzlePglite(client, { schema }) as unknown as AppDb;
    let txChain: Promise<unknown> = Promise.resolve();
    const originalTx = rawDb.transaction.bind(rawDb);
    const db = new Proxy(rawDb, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return <T>(fn: Parameters<AppDb['transaction']>[0], config?: Parameters<AppDb['transaction']>[1]): Promise<T> => {
            const next = txChain.then(() => originalTx(fn, config) as Promise<T>);
            txChain = next.catch(() => undefined);
            return next;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    return {
      db,
      executeRaw: async (sqlText: string) => {
        await client.waitReady;
        return client.exec(sqlText);
      },
      queryRaw: async <T extends Record<string, unknown>>(sqlText: string, params?: unknown[]) => {
        await client.waitReady;
        const res = await client.query<T>(sqlText, params);
        return res.rows;
      },
      close: async () => {
        await client.close();
      },
    };
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzlePg(pool, { schema });
  return {
    db,
    executeRaw: async (sqlText: string) => pool.query(sqlText),
    queryRaw: async <T extends Record<string, unknown>>(sqlText: string, params?: unknown[]) => {
      const res = await pool.query<T>(sqlText, params);
      return res.rows;
    },
    close: async () => {
      await pool.end();
    },
  };
}

/**
 * Returns the process-wide Drizzle database instance for the configured DATABASE_URL.
 */
export function getDb(): AppDb {
  const url = getEnv().DATABASE_URL;
  let handle = getCachedHandle();
  if (!handle || globalForDb.__samitiDbUrl !== url) {
    handle = createDbClient(url);
    setCachedHandle(handle, url);
  }
  return handle.db;
}

/**
 * Executes raw SQL against the configured database (used in migrations and tests).
 */
export async function executeRawSql(sqlText: string, databaseUrl?: string): Promise<unknown> {
  if (databaseUrl) {
    const client = createDbClient(databaseUrl);
    try {
      return await client.executeRaw(sqlText);
    } finally {
      await client.close();
    }
  }
  const url = getEnv().DATABASE_URL;
  let handle = getCachedHandle();
  if (!handle || globalForDb.__samitiDbUrl !== url) {
    handle = createDbClient(url);
    setCachedHandle(handle, url);
  }
  return handle.executeRaw(sqlText);
}

/**
 * Closes any cached database pool/instance (essential when switching DB URLs in tests).
 */
export async function closeDb(): Promise<void> {
  const handle = getCachedHandle();
  if (handle) {
    await handle.close();
    setCachedHandle(null, null);
  }
}

export { applyMigrations } from './migrate';
export * from './schema';
