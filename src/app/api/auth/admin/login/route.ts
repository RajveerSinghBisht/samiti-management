import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb, members } from '@/db';
import {
  decryptTotpSecret,
  dummySecretCheck,
  hashRecoveryCode,
  timingSafeEqualStr,
  verifyPassword,
  verifyTotpCode,
} from '@/lib/auth/crypto';
import { requirePreLoginCsrf } from '@/lib/auth/guards';
import {
  SESSION_COOKIE_NAME,
  attachSessionCookie,
  createSession,
  isSecureCookieContext,
} from '@/lib/auth/session';
import { getEnv } from '@/lib/env';
import { parseJsonBody } from '@/lib/http';
import { recordAuditEvent } from '@/lib/services/audit';

const adminLoginSchema = z.object({
  mobile: z.string().trim().regex(/^\d{10}$/),
  password: z.string().min(1).max(128),
  totpCode: z.string().trim().optional(),
  recoveryCode: z.string().trim().optional(),
});

const UNIFORM_ADMIN_ERROR = { error: 'Invalid credentials' };

export async function POST(req: NextRequest) {
  const csrfError = requirePreLoginCsrf(req);
  if (csrfError) return csrfError;

  const parsed = await parseJsonBody(req, adminLoginSchema);
  if ('errorResponse' in parsed) {
    return NextResponse.json(UNIFORM_ADMIN_ERROR, { status: 401 });
  }

  const env = getEnv();
  const db = getDb();
  const rows = await db
    .select()
    .from(members)
    .where(eq(members.mobile, parsed.data.mobile))
    .limit(1);

  const member = rows.at(0);
  if (
    !member ||
    member.role !== 'ADMIN' ||
    member.status !== 'ACTIVE' ||
    !member.passwordHash
  ) {
    await dummySecretCheck(env.PIN_PEPPER);
    return NextResponse.json(UNIFORM_ADMIN_ERROR, { status: 401 });
  }

  const now = new Date();
  if (member.lockedUntil && member.lockedUntil > now) {
    await dummySecretCheck(env.PIN_PEPPER);
    return NextResponse.json(UNIFORM_ADMIN_ERROR, { status: 401 });
  }

  const passOk = await verifyPassword(parsed.data.password, member.passwordHash, env.PIN_PEPPER);
  if (!passOk) {
    const nextAttempts = member.failedLoginAttempts + 1;
    const shouldLock = nextAttempts >= env.MAX_LOGIN_FAILURES;
    const lockedUntil = shouldLock
      ? new Date(now.getTime() + env.LOCKOUT_MINUTES * 60 * 1000)
      : null;

    await db
      .update(members)
      .set({ failedLoginAttempts: nextAttempts, lockedUntil, updatedAt: now })
      .where(eq(members.id, member.id));

    await recordAuditEvent({
      actorMemberId: member.id,
      actorRole: 'ADMIN',
      action: shouldLock ? 'ADMIN_LOCKOUT' : 'ADMIN_LOGIN_FAILED',
      targetType: 'member',
      targetId: member.id,
      metadata: { attempts: nextAttempts },
    });

    return NextResponse.json(UNIFORM_ADMIN_ERROR, { status: 401 });
  }

  // Case 1: Freshly seeded/created admin who must enroll TOTP before getting full admin access
  if (!member.totpEnabled) {
    await db
      .update(members)
      .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(members.id, member.id));

    const restrictedSession = await createSession({
      memberId: member.id,
      role: 'ADMIN',
      totpVerified: false,
      mustChangePin: false,
      previousSessionToken: req.cookies.get(SESSION_COOKIE_NAME)?.value,
    });

    const res = NextResponse.json({
      ok: true,
      role: 'ADMIN',
      requiresTotpSetup: true,
      totpVerified: false,
      csrfToken: restrictedSession.csrfToken,
      user: {
        id: member.id,
        name: member.name,
        mobile: member.mobile,
        role: member.role,
      },
    });
    attachSessionCookie(
      res,
      restrictedSession.rawToken,
      restrictedSession.maxAgeSeconds,
      isSecureCookieContext(req)
    );
    return res;
  }

  // Case 2: TOTP is enabled -> mandatory TOTP or single-use recovery code
  let secondFactorOk = false;
  let remainingRecoveryHashes: string[] | null = null;

  if (parsed.data.totpCode && member.totpSecretEncrypted) {
    const secret = decryptTotpSecret(member.totpSecretEncrypted, env.TOTP_ENCRYPTION_KEY);
    secondFactorOk = verifyTotpCode(secret, parsed.data.totpCode);
  } else if (parsed.data.recoveryCode && Array.isArray(member.recoveryCodesHashes)) {
    const candidateHash = hashRecoveryCode(parsed.data.recoveryCode, env.PIN_PEPPER);
    let matchedIdx = -1;
    for (let i = 0; i < member.recoveryCodesHashes.length; i++) {
      const stored = member.recoveryCodesHashes.at(i);
      if (stored && timingSafeEqualStr(stored, candidateHash)) {
        matchedIdx = i;
        break;
      }
    }
    if (matchedIdx >= 0) {
      secondFactorOk = true;
      remainingRecoveryHashes = member.recoveryCodesHashes.filter((_, idx) => idx !== matchedIdx);
    }
  }

  if (!secondFactorOk) {
    const nextAttempts = member.failedLoginAttempts + 1;
    const shouldLock = nextAttempts >= env.MAX_LOGIN_FAILURES;
    const lockedUntil = shouldLock
      ? new Date(now.getTime() + env.LOCKOUT_MINUTES * 60 * 1000)
      : null;

    await db
      .update(members)
      .set({ failedLoginAttempts: nextAttempts, lockedUntil, updatedAt: now })
      .where(eq(members.id, member.id));

    return NextResponse.json(UNIFORM_ADMIN_ERROR, { status: 401 });
  }

  await db
    .update(members)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      ...(remainingRecoveryHashes !== null
        ? { recoveryCodesHashes: remainingRecoveryHashes }
        : {}),
      updatedAt: now,
    })
    .where(eq(members.id, member.id));

  const session = await createSession({
    memberId: member.id,
    role: 'ADMIN',
    totpVerified: true,
    mustChangePin: false,
    previousSessionToken: req.cookies.get(SESSION_COOKIE_NAME)?.value,
  });

  await recordAuditEvent({
    actorMemberId: member.id,
    actorRole: 'ADMIN',
    action: 'ADMIN_LOGIN_SUCCESS',
    targetType: 'member',
    targetId: member.id,
    metadata: { usedRecoveryCode: remainingRecoveryHashes !== null },
  });

  const res = NextResponse.json({
    ok: true,
    role: 'ADMIN',
    requiresTotpSetup: false,
    totpVerified: true,
    csrfToken: session.csrfToken,
    user: {
      id: member.id,
      name: member.name,
      mobile: member.mobile,
      role: member.role,
    },
  });
  attachSessionCookie(res, session.rawToken, session.maxAgeSeconds, isSecureCookieContext(req));
  return res;
}

