import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb, members } from '@/db';
import { hashPin, validatePinFormat, verifyPin } from '@/lib/auth/crypto';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import {
  SESSION_COOKIE_NAME,
  attachSessionCookie,
  createSession,
  isSecureCookieContext,
} from '@/lib/auth/session';
import { getEnv } from '@/lib/env';
import { parseJsonBody } from '@/lib/http';
import { recordAuditEvent } from '@/lib/services/audit';

const changePinSchema = z.object({
  currentPin: z.string().trim().regex(/^\d{4,6}$/),
  newPin: z.string().trim().regex(/^\d{4,6}$/),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, {
    allowMustChangePin: true,
    requireCsrf: true,
  });
  if ('errorResponse' in auth) return auth.errorResponse;
  if (auth.session.role !== 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const parsed = await parseJsonBody(req, changePinSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  if (!validatePinFormat(parsed.data.newPin)) {
    return NextResponse.json({ error: 'New PIN must be 4 to 6 digits' }, { status: 400 });
  }

  const env = getEnv();
  const db = getDb();
  const rows = await db
    .select()
    .from(members)
    .where(eq(members.id, auth.session.memberId))
    .limit(1);
  const member = rows.at(0);
  if (!member || !member.pinHash) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentValid = await verifyPin(parsed.data.currentPin, member.pinHash, env.PIN_PEPPER);
  if (!currentValid) {
    return NextResponse.json({ error: 'Current PIN is incorrect' }, { status: 401 });
  }

  const newPinHash = await hashPin(parsed.data.newPin, env.PIN_PEPPER);
  await db
    .update(members)
    .set({
      pinHash: newPinHash,
      mustChangePin: false,
      updatedAt: new Date(),
    })
    .where(eq(members.id, member.id));

  const rotated = await createSession({
    memberId: member.id,
    role: 'MEMBER',
    totpVerified: true,
    mustChangePin: false,
    previousSessionToken: req.cookies.get(SESSION_COOKIE_NAME)?.value,
  });

  await recordAuditEvent({
    actorMemberId: member.id,
    actorRole: 'MEMBER',
    action: 'MEMBER_CHANGE_PIN',
    targetType: 'member',
    targetId: member.id,
  });

  const res = NextResponse.json({
    ok: true,
    mustChangePin: false,
    csrfToken: rotated.csrfToken,
  });
  attachSessionCookie(res, rotated.rawToken, rotated.maxAgeSeconds, isSecureCookieContext(req));
  return res;
}

