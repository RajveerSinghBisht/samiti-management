import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb, members } from '@/db';
import { dummySecretCheck, verifyPin } from '@/lib/auth/crypto';
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

const loginSchema = z.object({
  mobile: z.string().trim().regex(/^\d{10}$/),
  pin: z.string().trim().min(4).max(6),
});

const UNIFORM_LOGIN_ERROR = { error: 'Invalid credentials' };

export async function POST(req: NextRequest) {
  const csrfError = requirePreLoginCsrf(req);
  if (csrfError) return csrfError;

  const parsed = await parseJsonBody(req, loginSchema);
  if ('errorResponse' in parsed) {
    return NextResponse.json(UNIFORM_LOGIN_ERROR, { status: 401 });
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
    member.role !== 'MEMBER' ||
    member.status !== 'ACTIVE' ||
    !member.pinHash
  ) {
    await dummySecretCheck(env.PIN_PEPPER);
    return NextResponse.json(UNIFORM_LOGIN_ERROR, { status: 401 });
  }

  const now = new Date();
  if (member.lockedUntil && member.lockedUntil > now) {
    await dummySecretCheck(env.PIN_PEPPER);
    return NextResponse.json(UNIFORM_LOGIN_ERROR, { status: 401 });
  }

  const valid = await verifyPin(parsed.data.pin, member.pinHash, env.PIN_PEPPER);
  if (!valid) {
    const nextAttempts = member.failedLoginAttempts + 1;
    const shouldLock = nextAttempts >= env.MAX_LOGIN_FAILURES;
    const lockedUntil = shouldLock
      ? new Date(now.getTime() + env.LOCKOUT_MINUTES * 60 * 1000)
      : null;

    await db
      .update(members)
      .set({
        failedLoginAttempts: nextAttempts,
        lockedUntil,
        updatedAt: now,
      })
      .where(eq(members.id, member.id));

    await recordAuditEvent({
      actorMemberId: member.id,
      actorRole: 'MEMBER',
      action: shouldLock ? 'MEMBER_LOCKOUT' : 'MEMBER_LOGIN_FAILED',
      targetType: 'member',
      targetId: member.id,
      metadata: { attempts: nextAttempts },
    });

    return NextResponse.json(UNIFORM_LOGIN_ERROR, { status: 401 });
  }

  await db
    .update(members)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: now,
    })
    .where(eq(members.id, member.id));

  const session = await createSession({
    memberId: member.id,
    role: 'MEMBER',
    totpVerified: true,
    mustChangePin: member.mustChangePin,
    previousSessionToken: req.cookies.get(SESSION_COOKIE_NAME)?.value,
  });

  await recordAuditEvent({
    actorMemberId: member.id,
    actorRole: 'MEMBER',
    action: 'MEMBER_LOGIN_SUCCESS',
    targetType: 'member',
    targetId: member.id,
  });

  const res = NextResponse.json({
    ok: true,
    role: 'MEMBER',
    mustChangePin: member.mustChangePin,
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

