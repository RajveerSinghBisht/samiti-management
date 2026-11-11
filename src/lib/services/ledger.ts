import { asc, eq } from 'drizzle-orm';
import { getDb, ledgerEntries, type AppDb } from '@/db';
import type { CalcLedgerEntry, LedgerEntryType } from '@/lib/calc';
import { parseIstDateParts, toIstDateString } from '@/lib/dates';
import { parseStrictPaise } from '@/lib/money';
import { recordAuditEvent } from './audit';
import { ServiceError } from './errors';

export async function appendLedgerEntry(
  input: {
    cycleId: string;
    memberId: string | null;
    loanId: string | null;
    entryType: LedgerEntryType;
    amountPaise: number;
    effectiveDate: string;
    monthIndex?: number | null;
    reversesEntryId?: string | null;
    reason?: string | null;
    idempotencyKey?: string | null;
    createdByAdminId: string;
  },
  dbOrTx: AppDb = getDb()
) {
  parseStrictPaise(input.amountPaise);
  parseIstDateParts(input.effectiveDate);

  if (input.entryType === 'REVERSAL' && !input.reversesEntryId) {
    throw new ServiceError(400, 'REVERSAL entry requires reversesEntryId');
  }
  if (input.entryType !== 'REVERSAL' && input.reversesEntryId) {
    throw new ServiceError(400, 'Only REVERSAL entries can set reversesEntryId');
  }

  const inserted = await dbOrTx
    .insert(ledgerEntries)
    .values({
      cycleId: input.cycleId,
      memberId: input.memberId,
      loanId: input.loanId,
      entryType: input.entryType,
      amountPaise: input.amountPaise,
      effectiveDate: input.effectiveDate,
      monthIndex: input.monthIndex ?? null,
      reversesEntryId: input.reversesEntryId ?? null,
      reason: input.reason ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdByAdminId: input.createdByAdminId,
    })
    .returning();

  const row = inserted.at(0);
  if (!row) {
    throw new ServiceError(500, 'Failed to insert ledger entry');
  }
  return row;
}

export async function getCycleLedgerEntries(
  cycleId: string,
  dbOrTx: AppDb = getDb()
): Promise<CalcLedgerEntry[]> {
  const rows = await dbOrTx
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.cycleId, cycleId))
    .orderBy(asc(ledgerEntries.effectiveDate), asc(ledgerEntries.createdAt), asc(ledgerEntries.id));

  return rows.map((r) => ({
    id: r.id,
    memberId: r.memberId,
    loanId: r.loanId,
    entryType: r.entryType,
    amountPaise: r.amountPaise,
    effectiveDate: r.effectiveDate,
    monthIndex: r.monthIndex,
    reversesEntryId: r.reversesEntryId,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function reverseLedgerEntry(
  input: {
    ledgerEntryId: string;
    reason: string;
    adminId: string;
    replacement?: {
      entryType: Exclude<LedgerEntryType, 'REVERSAL'>;
      amountPaise: number;
      effectiveDate: string;
      monthIndex?: number | null;
      memberId?: string | null;
      loanId?: string | null;
    };
  },
  outerTx?: AppDb
) {
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new ServiceError(400, 'A reason (min 3 characters) is required for reversals');
  }

  const run = async (tx: AppDb) => {
    const targets = await tx
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, input.ledgerEntryId))
      .limit(1);

    const target = targets.at(0);
    if (!target) {
      throw new ServiceError(404, 'Ledger entry not found');
    }
    if (target.entryType === 'REVERSAL') {
      throw new ServiceError(400, 'Cannot reverse a REVERSAL entry');
    }

    let reversalEntry;
    try {
      reversalEntry = await appendLedgerEntry(
        {
          cycleId: target.cycleId,
          memberId: target.memberId,
          loanId: target.loanId,
          entryType: 'REVERSAL',
          amountPaise: target.amountPaise,
          effectiveDate: toIstDateString(),
          monthIndex: target.monthIndex,
          reversesEntryId: target.id,
          reason,
          createdByAdminId: input.adminId,
        },
        tx
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const code = (err as { code?: string })?.code;
      const causeMsg =
        err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
      if (
        code === '23505' ||
        msg.toLowerCase().includes('unique') ||
        msg.toLowerCase().includes('duplicate') ||
        causeMsg.toLowerCase().includes('unique') ||
        causeMsg.toLowerCase().includes('duplicate')
      ) {
        throw new ServiceError(409, 'Ledger entry has already been reversed');
      }
      throw err;
    }

    let replacementEntry = null;
    if (input.replacement) {
      replacementEntry = await appendLedgerEntry(
        {
          cycleId: target.cycleId,
          memberId:
            input.replacement.memberId !== undefined
              ? input.replacement.memberId
              : target.memberId,
          loanId:
            input.replacement.loanId !== undefined ? input.replacement.loanId : target.loanId,
          entryType: input.replacement.entryType,
          amountPaise: input.replacement.amountPaise,
          effectiveDate: input.replacement.effectiveDate,
          monthIndex:
            input.replacement.monthIndex !== undefined
              ? input.replacement.monthIndex
              : target.monthIndex,
          reason: `Correction replacement: ${reason}`,
          createdByAdminId: input.adminId,
        },
        tx
      );
    }

    await recordAuditEvent(
      {
        actorMemberId: input.adminId,
        actorRole: 'ADMIN',
        action: 'LEDGER_REVERSAL',
        targetType: 'ledger_entry',
        targetId: target.id,
        metadata: {
          reversalEntryId: reversalEntry.id,
          replacementEntryId: replacementEntry?.id ?? null,
          reason,
          amountPaise: target.amountPaise,
        },
      },
      tx
    );

    return { reversalEntry, replacementEntry };
  };

  if (outerTx) {
    return run(outerTx);
  }
  return getDb().transaction(run);
}

