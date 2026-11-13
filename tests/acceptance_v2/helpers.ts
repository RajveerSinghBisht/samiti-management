import {
  createIsolatedTestDb,
  loginAdminWithTotpSetup,
  makeJsonRequest,
  setRequiredTestEnv,
  type TestDbHandle,
} from '../acceptance/helpers';
import { applyMigrations } from '@/db';

export { makeJsonRequest, loginAdminWithTotpSetup, createIsolatedTestDb, setRequiredTestEnv };

export async function setupV2TestEnv(_testName?: string): Promise<{
  dbHandle?: TestDbHandle;
  admin1: Awaited<ReturnType<typeof loginAdminWithTotpSetup>>;
  admin2: Awaited<ReturnType<typeof loginAdminWithTotpSetup>>;
}> {
  void _testName;
  // If TEST_DATABASE_URL or DATABASE_URL is set (e.g. Real PostgreSQL), use it
  const dbUrl =
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://samiti_owner:samiti_owner_secret@127.0.0.1:5432/samiti_test';

  setRequiredTestEnv(dbUrl);
  await applyMigrations(dbUrl);

  const nonce = Math.floor(Math.random() * 89999 + 10000);
  const admin1 = await loginAdminWithTotpSetup({
    mobile: `98991${nonce}`,
    password: 'AdminPassword123#2026',
    name: 'Primary Admin V2',
  });

  const admin2 = await loginAdminWithTotpSetup({
    mobile: `98992${nonce}`,
    password: 'AdminPassword123#2026',
    name: 'Secondary Admin V2',
  });

  return { admin1, admin2 };
}
