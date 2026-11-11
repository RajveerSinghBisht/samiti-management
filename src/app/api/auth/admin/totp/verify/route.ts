import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getDb, members } from '@/db';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyTotpCode,
} from '@/lib/auth/crypto';
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

const verifySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit authenticator code'),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, {
    requireAdmin: true,
    allowUnverifiedTotp: true,
    requireCsrf: true,
  });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, verifySchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  const db = getDb();
  const rows = await db
    .select()
    .from(members)
    .where(eq(members.id, auth.session.memberId))
    .limit(1);
  const member = rows.at(0);
  if (!member || !member.totpPendingSecretEncrypted) {
    return NextResponse.json({ error: 'TOTP setup has not been started' }, { status: 400 });
  }

  const env = getEnv();
  const base32 = decryptTotpSecret(member.totpPendingSecretEncrypted, env.TOTP_ENCRYPTION_KEY);
  if (!verifyTotpCode(base32, parsed.data.code)) {
    return NextResponse.json({ error: 'Invalid authenticator code' }, { status: 400 });
  }

  const recoveryCodes = generateRecoveryCodes(8);
  const recoveryCodesHashes = recoveryCodes.map((c) => hashRecoveryCode(c, env.PIN_PEPPER));
  const encryptedPermanent = encryptTotpSecret(base32, env.TOTP_ENCRYPTION_KEY);

  await db
    .update(members)
    .set({
      totpSecretEncrypted: encryptedPermanent,
      totpPendingSecretEncrypted: null,
      totpEnabled: true,
      recoveryCodesHashes,
      updatedAt: new Date(),
    })
    .where(eq(members.id, member.id));

  const rotated = await createSession({
    memberId: member.id,
    role: 'ADMIN',
    totpVerified: true,
    mustChangePin: false,
    previousSessionToken: req.cookies.get(SESSION_COOKIE_NAME)?.value,
  });

  await recordAuditEvent({
    actorMemberId: member.id,
    actorRole: 'ADMIN',
    action: 'ADMIN_TOTP_ENABLED',
    targetType: 'member',
    targetId: member.id,
  });

  const res = NextResponse.json({
    ok: true,
    recoveryCodes,
    csrfToken: rotated.csrfToken,
  });
  attachSessionCookie(res, rotated.rawToken, rotated.maxAgeSeconds, isSecureCookieContext(req));
  return res;
}

