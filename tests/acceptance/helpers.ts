import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { TOTP } from 'otpauth';
import { resetEnvCacheForTests } from '@/lib/env';
import { applyMigrations, closeDb, createDbClient } from '@/db';
import { seedFirstAdmin } from '@/lib/auth/seed';

export interface TestDbHandle {
  databaseUrl: string;
  cleanup: () => Promise<void>;
}

export function setRequiredTestEnv(databaseUrl: string) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.SESSION_SECRET = 'test-session-secret-minimum-32-chars-long-001';
  process.env.PIN_PEPPER = 'test-pin-pepper-minimum-16-chars';
  process.env.TOTP_ENCRYPTION_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.CRON_SECRET = 'test-cron-secret-minimum-16-chars';
  process.env.APP_URL = 'http://localhost:3000';
  process.env.MESSAGING_PROVIDER = 'prepare';
  process.env.MAX_LOGIN_FAILURES = '5';
  process.env.LOCKOUT_MINUTES = '15';
  process.env.REVERSAL_APPROVAL_THRESHOLD_PAISE = '100000';
  resetEnvCacheForTests();
}

export async function createIsolatedTestDb(name: string): Promise<TestDbHandle> {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const tmpDir = path.resolve(process.cwd(), '.data', 'test-dbs', `${safeName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const databaseUrl = process.env.TEST_DATABASE_URL || `pglite://${tmpDir}`;
  await closeDb();
  setRequiredTestEnv(databaseUrl);
  await applyMigrations(databaseUrl);

  return {
    databaseUrl,
    cleanup: async () => {
      await closeDb();
      if (!process.env.TEST_DATABASE_URL && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}

export function extractCookies(res: Response): Record<string, string> {
  const jar: Record<string, string> = {};
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const raw of setCookies) {
    const firstPart = raw.split(';')[0];
    if (!firstPart) continue;
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const name = firstPart.slice(0, eqIdx).trim();
      const val = firstPart.slice(eqIdx + 1).trim();
      if (val === '') {
        delete jar[name];
      } else {
        jar[name] = val;
      }
    }
  }
  return jar;
}

export function mergeCookieJar(
  existing: Record<string, string>,
  res: Response
): Record<string, string> {
  return { ...existing, ...extractCookies(res) };
}

export function formatCookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export function makeJsonRequest(
  urlPath: string,
  options: {
    method?: string;
    body?: unknown;
    cookies?: Record<string, string>;
    csrfToken?: string;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const method = options.method || 'GET';
  const headers = new Headers(options.headers || {});
  headers.set('origin', 'http://localhost:3000');
  headers.set('host', 'localhost:3000');
  if (options.cookies && Object.keys(options.cookies).length > 0) {
    headers.set('cookie', formatCookieHeader(options.cookies));
  }
  if (options.csrfToken) {
    headers.set('x-csrf-token', options.csrfToken);
  }
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

export async function getPreLoginCsrf(): Promise<{
  csrfToken: string;
  cookies: Record<string, string>;
}> {
  const { GET } = await import('@/app/api/auth/csrf/route');
  const res = await GET(makeJsonRequest('/api/auth/csrf'));
  const data = (await res.json()) as { csrfToken: string };
  return {
    csrfToken: data.csrfToken,
    cookies: extractCookies(res),
  };
}

export async function loginAdminWithTotpSetup(input: {
  name: string;
  mobile: string;
  password: string;
  alreadySeeded?: boolean;
}): Promise<{
  adminId: string;
  cookies: Record<string, string>;
  csrfToken: string;
  totpSecret: string;
  recoveryCodes: string[];
}> {
  let adminId = '';
  if (!input.alreadySeeded) {
    const seeded = await seedFirstAdmin({
      name: input.name,
      mobile: input.mobile,
      password: input.password,
    });
    adminId = seeded.id;
  }

  const pre = await getPreLoginCsrf();
  const { POST: adminLogin } = await import('@/app/api/auth/admin/login/route');
  const loginRes = await adminLogin(
    makeJsonRequest('/api/auth/admin/login', {
      method: 'POST',
      cookies: pre.cookies,
      csrfToken: pre.csrfToken,
      body: { mobile: input.mobile, password: input.password },
    })
  );
  if (loginRes.status !== 200) {
    throw new Error(`Admin login failed with status ${loginRes.status}`);
  }
  const loginBody = (await loginRes.json()) as {
    user: { id: string };
    csrfToken: string;
  };
  adminId = loginBody.user.id;
  let cookies = mergeCookieJar(pre.cookies, loginRes);
  let csrfToken = loginBody.csrfToken;

  const { POST: totpSetup } = await import('@/app/api/auth/admin/totp/setup/route');
  const setupRes = await totpSetup(
    makeJsonRequest('/api/auth/admin/totp/setup', {
      method: 'POST',
      cookies,
      csrfToken,
      body: {},
    })
  );
  const setupBody = (await setupRes.json()) as { manualSecret: string };

  const totp = new TOTP({ secret: setupBody.manualSecret });
  const code = totp.generate();

  const { POST: totpVerify } = await import('@/app/api/auth/admin/totp/verify/route');
  const verifyRes = await totpVerify(
    makeJsonRequest('/api/auth/admin/totp/verify', {
      method: 'POST',
      cookies,
      csrfToken,
      body: { code },
    })
  );
  if (verifyRes.status !== 200) {
    throw new Error(`TOTP verify failed with status ${verifyRes.status}`);
  }
  const verifyBody = (await verifyRes.json()) as {
    recoveryCodes: string[];
    csrfToken: string;
  };
  cookies = mergeCookieJar(cookies, verifyRes);
  csrfToken = verifyBody.csrfToken;

  return {
    adminId,
    cookies,
    csrfToken,
    totpSecret: setupBody.manualSecret,
    recoveryCodes: verifyBody.recoveryCodes,
  };
}

export async function rawExecuteSql(databaseUrl: string, sql: string) {
  const client = createDbClient(databaseUrl);
  try {
    return await client.executeRaw(sql);
  } finally {
    await client.close();
  }
}
