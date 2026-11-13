import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, members } from '@/db';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { hashPassword, validateAdminPasswordFormat } from '@/lib/auth/crypto';
import { deleteAllMemberSessions } from '@/lib/auth/session';
import { getEnv } from '@/lib/env';
import { parseJsonBody, uuidSchema } from '@/lib/http';
import { recordAuditEvent } from '@/lib/services/audit';

const resetCredentialsSchema = z.object({
  newPassword: z.string().min(12).max(128).optional(),
  resetTotp: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const { id: targetAdminId } = await context.params;
  if (!uuidSchema.safeParse(targetAdminId).success) {
    return NextResponse.json({ error: 'Invalid admin ID' }, { status: 400 });
  }

  // Cross-admin rule: Admin passwords & TOTP can be reset ONLY by a different admin, never self-reset
  if (auth.session.memberId === targetAdminId) {
    return NextResponse.json(
      { error: 'An admin cannot reset their own credentials. A different admin is required.' },
      { status: 403 }
    );
  }

  const parsed = await parseJsonBody(req, resetCredentialsSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  const db = getDb();
  const env = getEnv();

  const targetRows = await db
    .select()
    .from(members)
    .where(eq(members.id, targetAdminId))
    .limit(1);
  const target = targetRows.at(0);

  if (!target || target.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    failedLoginAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date(),
  };

  if (parsed.data.newPassword) {
    if (!validateAdminPasswordFormat(parsed.data.newPassword)) {
      return NextResponse.json(
        { error: 'Password must be at least 12 characters' },
        { status: 400 }
      );
    }
    updates.passwordHash = await hashPassword(parsed.data.newPassword, env.PIN_PEPPER);
  }

  if (parsed.data.resetTotp) {
    updates.totpEnabled = false;
    updates.totpSecretEncrypted = null;
    updates.totpPendingSecretEncrypted = null;
    updates.recoveryCodesHashes = null;
  }

  await db.update(members).set(updates).where(eq(members.id, targetAdminId));
  await deleteAllMemberSessions(targetAdminId);

  await recordAuditEvent({
    actorMemberId: auth.session.memberId,
    actorRole: 'ADMIN',
    action: 'ADMIN_CREDENTIALS_RESET',
    targetType: 'admin',
    targetId: targetAdminId,
    metadata: {
      passwordReset: !!parsed.data.newPassword,
      totpReset: !!parsed.data.resetTotp,
    },
  });

  return NextResponse.json({ success: true, message: 'Admin credentials reset successfully' });
}

