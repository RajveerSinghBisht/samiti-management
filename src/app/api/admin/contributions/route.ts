import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { contributionSchedule, cycles, getDb, members } from '@/db';
import { resolveActiveEntries } from '@/lib/calc';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import {
  handleApiError,
  istDateSchema,
  parseJsonBody,
  strictPositiveIntSchema,
  uuidSchema,
} from '@/lib/http';
import { recordAuditEvent } from '@/lib/services/audit';
import { getActiveCycle } from '@/lib/services/cycles';
import { ServiceError } from '@/lib/services/errors';
import { appendLedgerEntry, getCycleLedgerEntries } from '@/lib/services/ledger';

const contribSchema = z.object({
  cycleId: uuidSchema,
  memberId: uuidSchema,
  monthIndex: strictPositiveIntSchema.max(120),
  amountPaise: strictPositiveIntSchema,
  effectiveDate: istDateSchema,
});

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    const db = getDb();
    const cycleIdParam = req.nextUrl.searchParams.get('cycleId');
    const cycle = cycleIdParam
      ? (await db.select().from(cycles).where(eq(cycles.id, cycleIdParam)).limit(1)).at(0)
      : await getActiveCycle();

    if (!cycle) {
      return NextResponse.json({ cycle: null, entries: [], members: [] });
    }

    const memberRows = await db
      .select({
        id: members.id,
        name: members.name,
        mobile: members.mobile,
        role: members.role,
        status: members.status,
      })
      .from(members)
      .where(eq(members.role, 'MEMBER'));

    const allEntries = await getCycleLedgerEntries(cycle.id, db);
    const activeContribs = resolveActiveEntries(allEntries).filter(
      (e) => e.entryType === 'CONTRIBUTION'
    );

    return NextResponse.json({
      cycle,
      members: memberRows,
      contributions: activeContribs,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, contribSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const db = getDb();
    const entry = await db.transaction(async (tx) => {
      const cycleRows = await tx
        .select()
        .from(cycles)
        .where(eq(cycles.id, parsed.data.cycleId))
        .limit(1);
      const cycle = cycleRows.at(0);
      if (!cycle) throw new ServiceError(404, 'Cycle not found');
      if (cycle.status !== 'ACTIVE') throw new ServiceError(409, 'Cycle is not active');
      if (parsed.data.monthIndex > cycle.lengthMonths) {
        throw new ServiceError(400, 'monthIndex exceeds cycle length');
      }

      const memberRows = await tx
        .select()
        .from(members)
        .where(eq(members.id, parsed.data.memberId))
        .limit(1);
      const member = memberRows.at(0);
      if (!member) throw new ServiceError(404, 'Member not found');

      const entries = await getCycleLedgerEntries(cycle.id, tx);
      const active = resolveActiveEntries(entries);
      const alreadyPaid = active.some(
        (e) =>
          e.entryType === 'CONTRIBUTION' &&
          e.memberId === member.id &&
          e.monthIndex === parsed.data.monthIndex
      );
      if (alreadyPaid) {
        throw new ServiceError(409, 'Contribution already recorded for this member and month');
      }

      const inserted = await appendLedgerEntry(
        {
          cycleId: cycle.id,
          memberId: member.id,
          loanId: null,
          entryType: 'CONTRIBUTION',
          amountPaise: parsed.data.amountPaise,
          effectiveDate: parsed.data.effectiveDate,
          monthIndex: parsed.data.monthIndex,
          reason: `Month ${parsed.data.monthIndex} contribution`,
          createdByAdminId: auth.session.memberId,
        },
        tx
      );

      await tx
        .update(contributionSchedule)
        .set({ status: 'PAID' })
        .where(
          and(
            eq(contributionSchedule.cycleId, cycle.id),
            eq(contributionSchedule.memberId, member.id),
            eq(contributionSchedule.monthIndex, parsed.data.monthIndex)
          )
        );

      await recordAuditEvent(
        {
          actorMemberId: auth.session.memberId,
          actorRole: 'ADMIN',
          action: 'RECORD_CONTRIBUTION',
          targetType: 'ledger_entry',
          targetId: inserted.id,
          metadata: {
            memberId: member.id,
            monthIndex: parsed.data.monthIndex,
            amountPaise: parsed.data.amountPaise,
          },
        },
        tx
      );

      return inserted;
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

