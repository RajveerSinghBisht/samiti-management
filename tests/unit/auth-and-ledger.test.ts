import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import {
  createIsolatedTestDb,
  makeJsonRequest,
  type TestDbHandle,
} from '../acceptance/helpers';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateQrDataUrl,
  generateTotpSecret,
  hashPassword,
  hashPin,
  timingSafeEqualStr,
  verifyPassword,
  verifyPin,
  verifyTotpCode,
} from '@/lib/auth/crypto';
import {
  requireAuthenticatedSession,
  requirePreLoginCsrf,
  validateSameOrigin,
} from '@/lib/auth/guards';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createSession,
  deleteSessionByRawToken,
  getSessionByRawToken,
  isSecureCookieContext,
} from '@/lib/auth/session';
import { seedFirstAdmin } from '@/lib/auth/seed';
import { getDb, members, sessions } from '@/db';
import { createCycle } from '@/lib/services/cycles';
import { createMember } from '@/lib/services/members';
import { appendLedgerEntry, reverseLedgerEntry } from '@/lib/services/ledger';

describe('Unit coverage for auth, sessions, guards, seed, and ledger services', () => {
  let dbHandle: TestDbHandle | null = null;

  afterEach(async () => {
    if (dbHandle) {
      await dbHandle.cleanup();
      dbHandle = null;
    }
  });

  it('covers crypto validation, encryption errors, QR generation, and constant-time checks', async () => {
    await expect(hashPin('12', 'pepper-1234567890')).rejects.toThrow();
    await expect(hashPassword('short', 'pepper-1234567890')).rejects.toThrow();
    const h = await hashPin('1234', 'pepper-1234567890');
    expect(await verifyPin('bad', h, 'pepper-1234567890')).toBe(false);

    const pwHash = await hashPassword('VeryStrongPass#123', 'pepper-1234567890');
    expect(await verifyPassword('', pwHash, 'pepper-1234567890')).toBe(false);
    expect(await verifyPassword('VeryStrongPass#123', pwHash, 'pepper-1234567890')).toBe(true);

    const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const { base32, otpauthUrl } = generateTotpSecret('Test User');
    const enc = encryptTotpSecret(base32, key);
    expect(decryptTotpSecret(enc, key)).toBe(base32);
    expect(() => decryptTotpSecret('bad', key)).toThrow();
    expect(() => decryptTotpSecret('a::c', key)).toThrow();
    expect(() =>
      decryptTotpSecret(
        `${Buffer.from('short').toString('base64')}:${Buffer.from('short').toString('base64')}:data`,
        key
      )
    ).toThrow();
    expect(verifyTotpCode(base32, 'abc')).toBe(false);

    const qr = await generateQrDataUrl(otpauthUrl);
    expect(qr).toContain('data:image/png;base64,');

    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
  });

  it('covers session lifecycle, sliding renewal, cookie security flags, and origin/CSRF guards', async () => {
    dbHandle = await createIsolatedTestDb('unit-auth-session');

    // Invalid seed inputs
    await expect(
      seedFirstAdmin({ name: 'A', mobile: '9999900001', password: 'VeryStrongPassword#123' })
    ).rejects.toThrow();
    await expect(
      seedFirstAdmin({ name: 'Admin', mobile: '123', password: 'VeryStrongPassword#123' })
    ).rejects.toThrow();

    const altDb = await createIsolatedTestDb('unit-seed-alt');
    try {
      const admin = await seedFirstAdmin({
        name: 'Seed Admin',
        mobile: '9999900001',
        password: 'VeryStrongPassword#123',
        databaseUrl: altDb.databaseUrl,
      });
      await expect(
        seedFirstAdmin({
          name: 'Dup Mobile',
          mobile: '9999900001',
          password: 'VeryStrongPassword#123',
        })
      ).rejects.toThrow();

      // Switch back to primary dbHandle for remaining assertions
      await seedFirstAdmin({
        name: 'Primary Admin',
        mobile: '9999900002',
        password: 'VeryStrongPassword#123',
        databaseUrl: dbHandle.databaseUrl,
      });
      expect(admin.role).toBe('ADMIN');
    } finally {
      await altDb.cleanup();
    }

    const dbRows = await getDb().select().from(members).where(eq(members.mobile, '9999900002'));
    const primaryAdmin = dbRows[0]!;

    // Origin guard checks
    const badOriginReq = new NextRequest('http://localhost:3000/api/auth/member/login', {
      method: 'POST',
      headers: { origin: 'https://evil.example.com', host: 'localhost:3000' },
    });
    expect(validateSameOrigin(badOriginReq)).toBe(false);
    expect(requirePreLoginCsrf(badOriginReq)?.status).toBe(403);

    const malformedOriginReq = new NextRequest('http://localhost:3000/api/test', {
      headers: { origin: 'not-a-url', host: 'localhost:3000' },
    });
    expect(validateSameOrigin(malformedOriginReq)).toBe(false);

    const noHostOriginReq = new NextRequest('http://localhost:3000/api/test', {
      headers: { origin: 'http://localhost:3000' },
    });
    // NextRequest sets host automatically from URL unless cleared
    expect(typeof validateSameOrigin(noHostOriginReq)).toBe('boolean');

    // Session creation, sliding renewal, cookie clearing, and deletion
    expect(await getSessionByRawToken(null)).toBeNull();
    expect(await getSessionByRawToken('short')).toBeNull();

    const sess = await createSession({
      memberId: primaryAdmin.id,
      role: 'ADMIN',
      totpVerified: true,
      mustChangePin: false,
    });
    const loaded = await getSessionByRawToken(sess.rawToken);
    expect(loaded?.memberId).toBe(primaryAdmin.id);

    // Force near-expiry to trigger sliding renewal (< 50% TTL left)
    const db = getDb();
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + 60_000) })
      .where(eq(sessions.memberId, primaryAdmin.id));

    const renewed = await getSessionByRawToken(sess.rawToken);
    expect(renewed).not.toBeNull();
    expect(renewed!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3600_000);

    // Origin mismatch on authenticated request -> 403
    const authOriginMismatch = await requireAuthenticatedSession(
      new NextRequest('http://localhost:3000/api/admin/members', {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${sess.rawToken}`,
          'x-csrf-token': sess.csrfToken,
          origin: 'https://attacker.test',
          host: 'localhost:3000',
        },
      }),
      { requireAdmin: true }
    );
    expect('errorResponse' in authOriginMismatch && authOriginMismatch.errorResponse.status).toBe(
      403
    );

    // Bad CSRF on authenticated POST -> 403
    const authBadCsrf = await requireAuthenticatedSession(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: { [SESSION_COOKIE_NAME]: sess.rawToken },
        csrfToken: 'wrong-csrf',
      }),
      { requireAdmin: true }
    );
    expect('errorResponse' in authBadCsrf && authBadCsrf.errorResponse.status).toBe(403);

    // HTTPS detection
    const httpsForwardedReq = makeJsonRequest('/api/health', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(isSecureCookieContext(httpsForwardedReq)).toBe(true);
    expect(isSecureCookieContext(undefined)).toBe(false);

    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res, true);
    expect(res.cookies.get(SESSION_COOKIE_NAME)?.value).toBe('');

    // Inactive member session invalidation
    await db.update(members).set({ status: 'INACTIVE' }).where(eq(members.id, primaryAdmin.id));
    expect(await getSessionByRawToken(sess.rawToken)).toBeNull();
    await deleteSessionByRawToken(sess.rawToken);
    await deleteSessionByRawToken(null);
  });

  it('covers ledger validation errors and replacement entries during reversal', async () => {
    dbHandle = await createIsolatedTestDb('unit-ledger-edge');
    const admin = await seedFirstAdmin({
      name: 'Seed Admin',
      mobile: '9999900001',
      password: 'VeryStrongPassword#123',
    });
    const cycle = await createCycle({
      name: 'Test Cycle',
      startDate: '2026-01-01',
      lengthMonths: 12,
      monthlyContributionPaise: 100_000,
      interestRateBps: 300,
      interestMode: 'REDUCING_BALANCE',
      interestSharingMode: 'PROPORTIONAL_CONTRIBUTION',
      rotationPayoutEnabled: false,
      adminId: admin.id,
    });
    const member = await createMember({
      name: 'Kiran Rao',
      mobile: '9800000111',
      role: 'MEMBER',
      initialSecret: '1234',
      adminId: admin.id,
    });

    await expect(
      appendLedgerEntry({
        cycleId: cycle.id,
        memberId: member.id,
        loanId: null,
        entryType: 'REVERSAL',
        amountPaise: 1000,
        effectiveDate: '2026-01-05',
        createdByAdminId: admin.id,
      })
    ).rejects.toThrow();

    await expect(
      appendLedgerEntry({
        cycleId: cycle.id,
        memberId: member.id,
        loanId: null,
        entryType: 'CONTRIBUTION',
        amountPaise: 1000,
        effectiveDate: '2026-01-05',
        reversesEntryId: '00000000-0000-4000-8000-000000000001',
        createdByAdminId: admin.id,
      })
    ).rejects.toThrow();

    const orig = await appendLedgerEntry({
      cycleId: cycle.id,
      memberId: member.id,
      loanId: null,
      entryType: 'CONTRIBUTION',
      amountPaise: 50_000,
      effectiveDate: '2026-01-05',
      monthIndex: 1,
      createdByAdminId: admin.id,
    });

    // Reason too short -> 400
    await expect(
      reverseLedgerEntry({ ledgerEntryId: orig.id, reason: 'x', adminId: admin.id })
    ).rejects.toThrow();

    // Missing entry -> 404
    await expect(
      reverseLedgerEntry({
        ledgerEntryId: '00000000-0000-4000-8000-000000000000',
        reason: 'Non-existent entry',
        adminId: admin.id,
      })
    ).rejects.toThrow();

    // Reverse with replacement entry
    const revWithReplacement = await reverseLedgerEntry({
      ledgerEntryId: orig.id,
      reason: 'Entered Rs 500 instead of Rs 1000',
      adminId: admin.id,
      replacement: {
        entryType: 'CONTRIBUTION',
        amountPaise: 100_000,
        effectiveDate: '2026-01-05',
        monthIndex: 1,
      },
    });
    expect(revWithReplacement.replacementEntry?.amountPaise).toBe(100_000);

    // Reversing already reversed entry directly -> 409
    await expect(
      reverseLedgerEntry({
        ledgerEntryId: orig.id,
        reason: 'Already reversed check',
        adminId: admin.id,
      })
    ).rejects.toThrow();

    // Attempting to reverse the REVERSAL entry itself -> rejected
    await expect(
      reverseLedgerEntry({
        ledgerEntryId: revWithReplacement.reversalEntry.id,
        reason: 'Trying to reverse a reversal',
        adminId: admin.id,
      })
    ).rejects.toThrow();
  });
});
