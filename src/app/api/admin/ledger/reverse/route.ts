import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { approvals, getDb, ledgerEntries } from '@/db';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import {
  handleApiError,
  istDateSchema,
  parseJsonBody,
  strictPositiveIntSchema,
  uuidSchema,
} from '@/lib/http';
import { recordAuditEvent } from '@/lib/services/audit';
import { reverseLedgerEntry } from '@/lib/services/ledger';
import { getReversalApprovalThresholdPaise } from '@/lib/services/settings';

const reverseSchema = z.object({
  ledgerEntryId: uuidSchema,
  reason: z.string().trim().min(3).max(300),
  replacement: z
    .object({
      entryType: z.enum([
        'CONTRIBUTION',
        'LOAN_DISBURSEMENT',
        'REPAYMENT_PRINCIPAL',
        'REPAYMENT_INTEREST',
        'INTEREST_ACCRUAL',
        'ROTATION_PAYOUT',
        'SHARE_PAYOUT',
      ]),
      amountPaise: strictPositiveIntSchema,
      effectiveDate: istDateSchema,
      monthIndex: strictPositiveIntSchema.nullable().optional(),
      memberId: uuidSchema.nullable().optional(),
      loanId: uuidSchema.nullable().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, reverseSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const db = getDb();
    const targets = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, parsed.data.ledgerEntryId))
      .limit(1);

    const target = targets.at(0);
    if (!target) {
      return NextResponse.json({ error: 'Ledger entry not found' }, { status: 404 });
    }
    if (target.entryType === 'REVERSAL') {
      return NextResponse.json({ error: 'Cannot reverse a REVERSAL entry' }, { status: 400 });
    }

    const existingRev = await db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.reversesEntryId, target.id))
      .limit(1);
    if (existingRev.length > 0) {
      return NextResponse.json({ error: 'Ledger entry has already been reversed' }, { status: 409 });
    }

    const thresholdPaise = await getReversalApprovalThresholdPaise(db);
    if (target.amountPaise > thresholdPaise) {
      const insertedApprovals = await db
        .insert(approvals)
        .values({
          cycleId: target.cycleId,
          actionType: 'HIGH_VALUE_REVERSAL',
          targetId: target.id,
          amountPaise: target.amountPaise,
          payloadJson: {
            ledgerEntryId: target.id,
            reason: parsed.data.reason,
            replacement: parsed.data.replacement,
          },
          reason: parsed.data.reason,
          status: 'PENDING',
          requestedByAdminId: auth.session.memberId,
        })
        .returning();

      const approval = insertedApprovals.at(0);
      await recordAuditEvent({
        actorMemberId: auth.session.memberId,
        actorRole: 'ADMIN',
        action: 'REQUEST_HIGH_VALUE_REVERSAL',
        targetType: 'ledger_entry',
        targetId: target.id,
        metadata: {
          approvalId: approval?.id ?? null,
          amountPaise: target.amountPaise,
          thresholdPaise,
        },
      });

      return NextResponse.json(
        { status: 'PENDING_APPROVAL', approval },
        { status: 201 }
      );
    }

    const res = await reverseLedgerEntry({
      ledgerEntryId: target.id,
      reason: parsed.data.reason,
      adminId: auth.session.memberId,
      replacement: parsed.data.replacement,
    });

    return NextResponse.json(
      {
        status: 'REVERSED',
        reversalEntry: res.reversalEntry,
        replacementEntry: res.replacementEntry,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}

