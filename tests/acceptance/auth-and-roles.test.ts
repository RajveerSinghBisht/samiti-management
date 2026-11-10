import { afterEach, describe, expect, it } from 'vitest';
import { TOTP } from 'otpauth';
import {
  createIsolatedTestDb,
  extractCookies,
  getPreLoginCsrf,
  loginAdminWithTotpSetup,
  makeJsonRequest,
  mergeCookieJar,
  type TestDbHandle,
} from './helpers';
import { hashPin, verifyPin } from '@/lib/auth/crypto';
import { seedFirstAdmin } from '@/lib/auth/seed';

describe('Authentication, roles, pepper, lockout, TOTP, rotation, and CSRF', () => {
  let dbHandle: TestDbHandle | null = null;

  afterEach(async () => {
    if (dbHandle) {
      await dbHandle.cleanup();
      dbHandle = null;
    }
  });

  it('hashes PINs with bcrypt and env pepper; rejects wrong pepper', async () => {
    const hash = await hashPin('4829', 'pepper-alpha-123456');
    expect(hash).not.toContain('4829');
    expect(await verifyPin('4829', hash, 'pepper-alpha-123456')).toBe(true);
    expect(await verifyPin('4829', hash, 'wrong-pepper-123456')).toBe(false);
    expect(await verifyPin('0000', hash, 'pepper-alpha-123456')).toBe(false);
  });

  it('requires strong password for first admin CLI seed and prevents seeding twice', async () => {
    dbHandle = await createIsolatedTestDb('auth-seed');

    await expect(
      seedFirstAdmin({
        name: 'Admin One',
        mobile: '9999900001',
        password: 'short',
      })
    ).rejects.toThrow();

    const admin = await seedFirstAdmin({
      name: 'Admin One',
      mobile: '9999900001',
      password: 'VeryStrongAdminPassword#123',
    });
    expect(admin.role).toBe('ADMIN');

    await expect(
      seedFirstAdmin({
        name: 'Admin Two',
        mobile: '9999900002',
        password: 'AnotherStrongPassword#456',
      })
    ).rejects.toThrow();
  });

  it('enforces mandatory TOTP setup, single-use recovery codes, session rotation, CSRF, PIN lockout and forced PIN change on reset', async () => {
    dbHandle = await createIsolatedTestDb('auth-full');

    // 1. Seed & login admin before TOTP setup -> restricted session cannot access /api/admin/members
    await seedFirstAdmin({
      name: 'Admin One',
      mobile: '9999900001',
      password: 'VeryStrongAdminPassword#123',
    });

    const pre = await getPreLoginCsrf();
    const { POST: adminLogin } = await import('@/app/api/auth/admin/login/route');

    // CSRF required even on login
    const noCsrfLogin = await adminLogin(
      makeJsonRequest('/api/auth/admin/login', {
        method: 'POST',
        body: { mobile: '9999900001', password: 'VeryStrongAdminPassword#123' },
      })
    );
    expect(noCsrfLogin.status).toBe(403);

    // Uniform error for wrong password vs unknown mobile
    const wrongPassRes = await adminLogin(
      makeJsonRequest('/api/auth/admin/login', {
        method: 'POST',
        cookies: pre.cookies,
        csrfToken: pre.csrfToken,
        body: { mobile: '9999900001', password: 'WrongPassword123456' },
      })
    );
    const unknownMobileRes = await adminLogin(
      makeJsonRequest('/api/auth/admin/login', {
        method: 'POST',
        cookies: pre.cookies,
        csrfToken: pre.csrfToken,
        body: { mobile: '9000000000', password: 'WrongPassword123456' },
      })
    );
    expect(wrongPassRes.status).toBe(401);
    expect(unknownMobileRes.status).toBe(401);
    expect(await wrongPassRes.json()).toEqual(await unknownMobileRes.json());

    // First login with valid password & no TOTP yet -> restricted session
    const firstAdminLogin = await adminLogin(
      makeJsonRequest('/api/auth/admin/login', {
        method: 'POST',
        cookies: pre.cookies,
        csrfToken: pre.csrfToken,
        body: { mobile: '9999900001', password: 'VeryStrongAdminPassword#123' },
      })
    );
    expect(firstAdminLogin.status).toBe(200);
    const firstCookies = mergeCookieJar(pre.cookies, firstAdminLogin);
    const firstBody = (await firstAdminLogin.json()) as {
      requiresTotpSetup: boolean;
      csrfToken: string;
    };
    expect(firstBody.requiresTotpSetup).toBe(true);

    // Set-Cookie attributes: HttpOnly and SameSite
    const setCookieHeader = (firstAdminLogin.headers.getSetCookie?.() || []).join('; ');
    expect(setCookieHeader.toLowerCase()).toContain('httponly');
    expect(setCookieHeader.toLowerCase()).toContain('samesite=lax');

    // Restricted admin session CANNOT call /api/admin/members
    const { GET: listMembers, POST: createMemberRoute } = await import(
      '@/app/api/admin/members/route'
    );
    const blockedBeforeTotp = await listMembers(
      makeJsonRequest('/api/admin/members', { cookies: firstCookies })
    );
    expect(blockedBeforeTotp.status).toBe(403);

    // Complete TOTP setup
    const { POST: totpSetup } = await import('@/app/api/auth/admin/totp/setup/route');
    const setupRes = await totpSetup(
      makeJsonRequest('/api/auth/admin/totp/setup', {
        method: 'POST',
        cookies: firstCookies,
        csrfToken: firstBody.csrfToken,
        body: {},
      })
    );
    const setupBody = (await setupRes.json()) as { manualSecret: string };

    const { POST: totpVerify } = await import('@/app/api/auth/admin/totp/verify/route');
    const code = new TOTP({ secret: setupBody.manualSecret }).generate();
    const verifyRes = await totpVerify(
      makeJsonRequest('/api/auth/admin/totp/verify', {
        method: 'POST',
        cookies: firstCookies,
        csrfToken: firstBody.csrfToken,
        body: { code },
      })
    );
    expect(verifyRes.status).toBe(200);
    const verifyBody = (await verifyRes.json()) as {
      recoveryCodes: string[];
      csrfToken: string;
    };
    expect(verifyBody.recoveryCodes.length).toBeGreaterThanOrEqual(6);

    const verifiedCookies = mergeCookieJar(firstCookies, verifyRes);
    // Old restricted session token was rotated!
    expect(verifiedCookies.samiti_session).not.toBe(firstCookies.samiti_session);

    // Subsequent admin login MUST require TOTP or recovery code
    const pre2 = await getPreLoginCsrf();
    const missingTotpRes = await adminLogin(
      makeJsonRequest('/api/auth/admin/login', {
        method: 'POST',
        cookies: pre2.cookies,
        csrfToken: pre2.csrfToken,
        body: { mobile: '9999900001', password: 'VeryStrongAdminPassword#123' },
      })
    );
    expect(missingTotpRes.status).toBe(401);

    // Single-use recovery code works ONCE and cannot be reused
    const recoveryCode = verifyBody.recoveryCodes[0]!;
    const recoveryLogin1 = await adminLogin(
      makeJsonRequest('/api/auth/admin/login', {
        method: 'POST',
        cookies: pre2.cookies,
        csrfToken: pre2.csrfToken,
        body: {
          mobile: '9999900001',
          password: 'VeryStrongAdminPassword#123',
          recoveryCode,
        },
      })
    );
    expect(recoveryLogin1.status).toBe(200);

    const recoveryLogin2 = await adminLogin(
      makeJsonRequest('/api/auth/admin/login', {
        method: 'POST',
        cookies: pre2.cookies,
        csrfToken: pre2.csrfToken,
        body: {
          mobile: '9999900001',
          password: 'VeryStrongAdminPassword#123',
          recoveryCode,
        },
      })
    );
    expect(recoveryLogin2.status).toBe(401);

    // Admin creates a member with initial PIN 1234
    const createMemRes = await createMemberRoute(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: verifiedCookies,
        csrfToken: verifyBody.csrfToken,
        body: {
          name: 'Sita Devi',
          mobile: '9876511111',
          role: 'MEMBER',
          initialSecret: '1234',
        },
      })
    );
    expect(createMemRes.status).toBe(201);
    const createdMember = ((await createMemRes.json()) as { member: { id: string } }).member;

    // Member PIN brute force lockout after 5 failures
    const { POST: memberLogin } = await import('@/app/api/auth/member/login/route');
    const preM = await getPreLoginCsrf();
    for (let i = 0; i < 5; i++) {
      const failRes = await memberLogin(
        makeJsonRequest('/api/auth/member/login', {
          method: 'POST',
          cookies: preM.cookies,
          csrfToken: preM.csrfToken,
          body: { mobile: '9876511111', pin: '9999' },
        })
      );
      expect(failRes.status).toBe(401);
    }

    // Even with CORRECT PIN, account is locked out!
    const lockedOutRes = await memberLogin(
      makeJsonRequest('/api/auth/member/login', {
        method: 'POST',
        cookies: preM.cookies,
        csrfToken: preM.csrfToken,
        body: { mobile: '9876511111', pin: '1234' },
      })
    );
    expect(lockedOutRes.status).toBe(401);

    // Admin resets member PIN -> clears lockout and forces PIN change on next login
    const { POST: resetPinRoute } = await import('@/app/api/admin/members/[id]/reset-pin/route');
    const resetRes = await resetPinRoute(
      makeJsonRequest(`/api/admin/members/${createdMember.id}/reset-pin`, {
        method: 'POST',
        cookies: verifiedCookies,
        csrfToken: verifyBody.csrfToken,
        body: { newPin: '5678' },
      }),
      { params: Promise.resolve({ id: createdMember.id }) }
    );
    expect(resetRes.status).toBe(200);

    // Session fixation test: attacker supplies a pre-set samiti_session cookie before login
    const fixationAttemptCookies = { ...preM.cookies, samiti_session: 'attacker-fixed-session-id' };
    const memLoginRes = await memberLogin(
      makeJsonRequest('/api/auth/member/login', {
        method: 'POST',
        cookies: fixationAttemptCookies,
        csrfToken: preM.csrfToken,
        body: { mobile: '9876511111', pin: '5678' },
      })
    );
    expect(memLoginRes.status).toBe(200);
    const memBody = (await memLoginRes.json()) as { mustChangePin: boolean; csrfToken: string };
    expect(memBody.mustChangePin).toBe(true);
    const newSessionCookie = extractCookies(memLoginRes).samiti_session;
    expect(newSessionCookie).toBeTruthy();
    expect(newSessionCookie).not.toBe('attacker-fixed-session-id');

    const memCookies = mergeCookieJar(preM.cookies, memLoginRes);

    // While mustChangePin is true, member cannot view summary until setting a new PIN
    const { GET: memberSummary } = await import('@/app/api/member/summary/route');
    const blockedSummary = await memberSummary(
      makeJsonRequest('/api/member/summary', { cookies: memCookies })
    );
    expect(blockedSummary.status).toBe(403);

    // Member changes PIN -> session rotates -> member summary now works
    const { POST: changePin } = await import('@/app/api/auth/member/change-pin/route');
    const changeRes = await changePin(
      makeJsonRequest('/api/auth/member/change-pin', {
        method: 'POST',
        cookies: memCookies,
        csrfToken: memBody.csrfToken,
        body: { currentPin: '5678', newPin: '7788' },
      })
    );
    expect(changeRes.status).toBe(200);
    const rotatedMemCookies = mergeCookieJar(memCookies, changeRes);
    expect(rotatedMemCookies.samiti_session).not.toBe(memCookies.samiti_session);

    const allowedSummary = await memberSummary(
      makeJsonRequest('/api/member/summary', { cookies: rotatedMemCookies })
    );
    expect(allowedSummary.status).toBe(200);
  });

  it('helper loginAdminWithTotpSetup returns verified admin session', async () => {
    dbHandle = await createIsolatedTestDb('auth-helper');
    const admin = await loginAdminWithTotpSetup({
      name: 'Admin Helper',
      mobile: '9999900099',
      password: 'VeryStrongAdminPassword#999',
    });
    expect(admin.adminId).toBeTruthy();
    expect(admin.csrfToken).toBeTruthy();
  });
});

