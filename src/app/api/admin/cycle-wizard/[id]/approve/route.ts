import { NextResponse, type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { approvals, cycles, getDb } from '@/db';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError, uuidSchema } from '@/lib/http';
import { recordAuditEvent } from '@/lib/services/audit';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const { id: cycleId } = await context.params;
  if (!uuidSchema.safeParse(cycleId).success) {
    return NextResponse.json({ error: 'Invalid cycle ID' }, { status: 400 });
  }

  const db = getDb();
  try {
    const cycleRows = await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1);
    const cycle = cycleRows.at(0);
    if (!cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
    }

    if (cycle.status !== 'PENDING_SECOND_ADMIN_APPROVAL') {
      return NextResponse.json({ error: `Cycle is already ${cycle.status}` }, { status: 409 });
    }

    // Two-admin rule: Requester cannot approve their own creation
    if (cycle.createdByAdminId === auth.session.memberId) {
      return NextResponse.json(
        { error: 'A second, different admin must approve cycle activation' },
        { status: 403 }
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(cycles)
        .set({ status: 'ACTIVE' })
        .where(eq(cycles.id, cycleId));

      await tx
        .update(approvals)
        .set({
          status: 'APPROVED',
          decidedByAdminId: auth.session.memberId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(approvals.cycleId, cycleId),
            eq(approvals.actionType, 'CYCLE_ACTIVATION'),
            eq(approvals.status, 'PENDING')
          )
        );
    });

    await recordAuditEvent({
      actorMemberId: auth.session.memberId,
      actorRole: 'ADMIN',
      action: 'CYCLE_ACTIVATED',
      targetType: 'cycle',
      targetId: cycleId,
      metadata: { activatedByAdminId: auth.session.memberId },
    });

    return NextResponse.json({ ok: true, status: 'ACTIVE', cycleId });
  } catch (err) {
    return handleApiError(err);
  }
}

