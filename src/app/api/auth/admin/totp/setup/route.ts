import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { getDb, members } from '@/db';
import {
  encryptTotpSecret,
  generateQrDataUrl,
  generateTotpSecret,
} from '@/lib/auth/crypto';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { getEnv } from '@/lib/env';

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, {
    requireAdmin: true,
    allowUnverifiedTotp: true,
    requireCsrf: true,
  });
  if ('errorResponse' in auth) return auth.errorResponse;

  const db = getDb();
  const rows = await db
    .select()
    .from(members)
    .where(eq(members.id, auth.session.memberId))
    .limit(1);
  const member = rows.at(0);
  if (!member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (member.totpEnabled && !auth.session.totpVerified) {
    return NextResponse.json(
      { error: 'Authenticator is already enabled on this account' },
      { status: 403 }
    );
  }

  const env = getEnv();
  const { base32, otpauthUrl } = generateTotpSecret(`${member.name} (${member.mobile})`);
  const encryptedPending = encryptTotpSecret(base32, env.TOTP_ENCRYPTION_KEY);

  await db
    .update(members)
    .set({
      totpPendingSecretEncrypted: encryptedPending,
      updatedAt: new Date(),
    })
    .where(eq(members.id, member.id));

  const qrDataUrl = await generateQrDataUrl(otpauthUrl);

  return NextResponse.json({
    manualSecret: base32,
    otpauthUrl,
    qrDataUrl,
  });
}

