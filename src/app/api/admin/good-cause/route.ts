import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { approvals, cycles, getDb, loans } from '@/db';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { calculateGroupTotals } from '@/lib/calc';
import {
  handleApiError,
  istDateSchema,
  parseJsonBody,
  strictPositiveIntSchema,
  uuidSchema,
} from '@/lib/http';
import { recordAuditEvent } from '@/lib/services/audit';
import { getCycleLedgerEntries } from '@/lib/services/ledger';

const createGrantSchema = z.object({
  cycleId: uuidSchema,
  meetingDate: istDateSchema,
  recipient: z.string().trim().min(2).max(200),
  reason: z.string().trim().min(2).max(500),
  amountPaise: strictPositiveIntSchema,
  consentNote: z.string().trim().min(2).max(1000),
  confirmedExceedsPool: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, createGrantSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  const db = getDb();
  try {
    const cycleRows = await db
      .select()
      .from(cycles)
      .where(eq(cycles.id, parsed.data.cycleId))
      .limit(1);
    const cycle = cycleRows.at(0);
    if (!cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
    }

    const entries = await getCycleLedgerEntries(cycle.id);
    const cycleLoans = await db.select().from(loans).where(eq(loans.cycleId, cycle.id));

    const totals = calculateGroupTotals({
      entries,
      settings: {
        startDate: cycle.startDate,
        lengthMonths: cycle.lengthMonths,
        monthlyContributionPaise: cycle.monthlyContributionPaise,
        interestRateBps: cycle.interestRateBps,
        interestMode: cycle.interestMode,
        interestSharingMode: cycle.interestSharingMode,
        rotationPayoutEnabled: cycle.rotationPayoutEnabled,
        lateRuleMode: cycle.lateRuleMode,
        lateRuleValue: cycle.lateRuleValue,
      },
      loans: cycleLoans.map((l) => ({
        id: l.id,
        memberId: l.memberId,
        disbursedDate: l.disbursedDate,
        principalPaise: l.principalPaise,
        interestRateBps: l.interestRateBps,
        interestMode: l.interestMode,
      })),
      asOfDate: parsed.data.meetingDate,
    });

    const netInterestCollectedPaise =
      totals.totalInterestCollectedPaise +
      totals.totalBankInterestPaise -
      totals.totalGoodCauseGrantsPaise;

    if (parsed.data.amountPaise > netInterestCollectedPaise && !parsed.data.confirmedExceedsPool) {
      return NextResponse.json(
        {
          error:
            'Good cause grant exceeds collected interest pool. Explicit confirmation is required.',
          availableInterestPaise: Math.max(0, netInterestCollectedPaise),
        },
        { status: 400 }
      );
    }

    const inserted = await db
      .insert(approvals)
      .values({
        cycleId: cycle.id,
        actionType: 'GOOD_CAUSE_GRANT',
        targetId: cycle.id,
        amountPaise: parsed.data.amountPaise,
        payloadJson: {
          cycleId: cycle.id,
          meetingDate: parsed.data.meetingDate,
          recipient: parsed.data.recipient,
          reason: parsed.data.reason,
          consentNote: parsed.data.consentNote,
          amountPaise: parsed.data.amountPaise,
          confirmedExceedsPool: parsed.data.confirmedExceedsPool,
        },
        reason: `Good cause grant to ${parsed.data.recipient}: ${parsed.data.reason}`,
        status: 'PENDING',
        requestedByAdminId: auth.session.memberId,
      })
      .returning();

    const approval = inserted.at(0);
    if (!approval) {
      return NextResponse.json({ error: 'Failed to create approval request' }, { status: 500 });
    }

    await recordAuditEvent({
      actorMemberId: auth.session.memberId,
      actorRole: 'ADMIN',
      action: 'REQUEST_GOOD_CAUSE_GRANT',
      targetType: 'approval',
      targetId: approval.id,
      metadata: {
        cycleId: cycle.id,
        amountPaise: parsed.data.amountPaise,
        recipient: parsed.data.recipient,
      },
    });

    return NextResponse.json(
      {
        approvalId: approval.id,
        message: 'Good cause grant submitted for second-admin approval',
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}

