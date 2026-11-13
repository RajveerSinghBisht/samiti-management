import { and, desc, eq, sql } from 'drizzle-orm';
import { approvals, cycles, getDb, loans, members, type AppDb } from '@/db';
import {
  allocateRepayment,
  calculateLoanAccruedInterestForMonth,
  calculateLoanBalance,
} from '@/lib/calc';
import { parseIstDateParts, toIstDateString } from '@/lib/dates';
import { parseStrictPaise } from '@/lib/money';
import { recordAuditEvent } from './audit';
import { ServiceError } from './errors';
import { appendLedgerEntry, getCycleLedgerEntries } from './ledger';

export async function listLoans(cycleId?: string) {
  const db = getDb();
  const loanRows = cycleId
    ? await db.select().from(loans).where(eq(loans.cycleId, cycleId)).orderBy(desc(loans.createdAt))
    : await db.select().from(loans).orderBy(desc(loans.createdAt));

  const today = toIstDateString();
  const entriesByCycle = new Map<string, Awaited<ReturnType<typeof getCycleLedgerEntries>>>();
  const memberRows = await db
    .select({ id: members.id, name: members.name, mobile: members.mobile })
    .from(members);
  const memberMap = new Map(memberRows.map((m) => [m.id, m]));

  const results = [];
  for (const loan of loanRows) {
    let entries = entriesByCycle.get(loan.cycleId);
    if (!entries) {
      entries = await getCycleLedgerEntries(loan.cycleId, db);
      entriesByCycle.set(loan.cycleId, entries);
    }
    const balance =
      loan.status === 'ACTIVE' || loan.status === 'CLOSED'
        ? calculateLoanBalance({
            loanId: loan.id,
            disbursedDate: loan.disbursedDate,
            principalPaise: loan.principalPaise,
            interestRateBps: loan.interestRateBps,
            interestMode: loan.interestMode,
            entries,
            asOfDate: today,
          })
        : null;

    const m = memberMap.get(loan.memberId);
    results.push({
      ...loan,
      memberName: m?.name ?? 'Unknown',
      memberMobile: m?.mobile ?? '',
      balance,
    });
  }
  return results;
}

export async function requestLoan(input: {
  cycleId: string;
  memberId: string;
  principalPaise: number;
  interestRateBps?: number;
  repaymentMode?: 'MONTHLY_INSTALLMENTS' | 'FULL_REPAYMENT';
  termMonths?: number;
  dueDate?: string;
  disbursedDate: string;
  isEmergency?: boolean;
  emergencyReason?: string;
  note?: string;
  adminId: string;
}) {
  parseStrictPaise(input.principalPaise);
  parseIstDateParts(input.disbursedDate);

  const db = getDb();
  return db.transaction(async (tx: AppDb) => {
    const cycleRows = await tx
      .select()
      .from(cycles)
      .where(eq(cycles.id, input.cycleId))
      .limit(1);
    const cycle = cycleRows.at(0);
    if (!cycle) throw new ServiceError(404, 'Cycle not found');
    if (cycle.status !== 'ACTIVE') throw new ServiceError(409, 'Cycle is not active');

    const memberRows = await tx
      .select()
      .from(members)
      .where(eq(members.id, input.memberId))
      .limit(1);
    const member = memberRows.at(0);
    if (!member || member.status !== 'ACTIVE') {
      throw new ServiceError(404, 'Active member not found');
    }

    const memberLoans = await tx
      .select()
      .from(loans)
      .where(
        and(
          eq(loans.cycleId, cycle.id),
          eq(loans.memberId, member.id),
          eq(loans.status, 'ACTIVE')
        )
      );

    const entries = await getCycleLedgerEntries(cycle.id, tx);
    let currentOutstandingPaise = 0;
    for (const ml of memberLoans) {
      const bal = calculateLoanBalance({
        loanId: ml.id,
        disbursedDate: ml.disbursedDate,
        principalPaise: ml.principalPaise,
        interestRateBps: ml.interestRateBps,
        interestMode: ml.interestMode,
        entries,
        asOfDate: input.disbursedDate,
      });
      currentOutstandingPaise += bal.outstandingPrincipalPaise;
    }

    const newTotalPrincipalPaise = currentOutstandingPaise + input.principalPaise;
    const isEmergency = Boolean(input.isEmergency);
    const emergencyReason = input.emergencyReason?.trim() || null;

    if (newTotalPrincipalPaise > cycle.normalLoanCapPaise) {
      if (!isEmergency) {
        throw new ServiceError(
          400,
          `Requested loan exceeds normal member cap of Rs ${cycle.normalLoanCapPaise / 100}. Emergency loan confirmation and reason required.`
        );
      }
      if (!emergencyReason) {
        throw new ServiceError(400, 'Emergency reason is required for loans exceeding normal cap');
      }
      if (newTotalPrincipalPaise > cycle.emergencyLoanCapPaise) {
        throw new ServiceError(
          400,
          `Requested loan exceeds emergency member cap of Rs ${cycle.emergencyLoanCapPaise / 100}`
        );
      }
    }

    const interestRateBps = input.interestRateBps ?? cycle.interestRateBps;
    const repaymentMode = input.repaymentMode ?? 'MONTHLY_INSTALLMENTS';
    const termMonths =
      input.termMonths ?? (repaymentMode === 'MONTHLY_INSTALLMENTS' ? 12 : null);

    let dueDate = input.dueDate || null;
    if (!dueDate && repaymentMode === 'MONTHLY_INSTALLMENTS') {
      const parts = input.disbursedDate.split('-');
      const y = Number(parts[0] ?? 2026);
      const m = Number(parts[1] ?? 1);
      const d = parts[2] ?? '01';
      let ny = y;
      let nm = m + 1;
      if (nm > 12) {
        ny += 1;
        nm = 1;
      }
      dueDate = `${ny}-${String(nm).padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    const insertedLoans = await tx
      .insert(loans)
      .values({
        cycleId: cycle.id,
        memberId: member.id,
        principalPaise: input.principalPaise,
        interestRateBps,
        interestMode: cycle.interestMode,
        repaymentMode,
        termMonths,
        dueDate,
        isEmergency,
        emergencyReason,
        disbursedDate: input.disbursedDate,
        status: 'PENDING_APPROVAL',
        note: input.note?.trim() || null,
        requestedByAdminId: input.adminId,
      })
      .returning();

    const loan = insertedLoans.at(0);
    if (!loan) throw new ServiceError(500, 'Failed to create loan');

    const actionType = isEmergency ? 'EMERGENCY_LOAN' : 'LOAN_APPROVAL';
    const insertedApprovals = await tx
      .insert(approvals)
      .values({
        cycleId: cycle.id,
        actionType,
        targetId: loan.id,
        amountPaise: loan.principalPaise,
        payloadJson: {
          loanId: loan.id,
          memberId: member.id,
          memberName: member.name,
          principalPaise: loan.principalPaise,
          interestRateBps,
          repaymentMode,
          termMonths,
          isEmergency,
          emergencyReason,
          disbursedDate: loan.disbursedDate,
        },
        reason:
          input.note?.trim() ||
          (isEmergency ? `Emergency loan: ${emergencyReason}` : 'Loan approval request'),
        status: 'PENDING',
        requestedByAdminId: input.adminId,
      })
      .returning();

    const approval = insertedApprovals.at(0);
    if (!approval) throw new ServiceError(500, 'Failed to create loan approval');

    await tx.update(loans).set({ approvalId: approval.id }).where(eq(loans.id, loan.id));

    await recordAuditEvent(
      {
        actorMemberId: input.adminId,
        actorRole: 'ADMIN',
        action: 'REQUEST_LOAN',
        targetType: 'loan',
        targetId: loan.id,
        metadata: {
          memberId: member.id,
          principalPaise: loan.principalPaise,
          approvalId: approval.id,
        },
      },
      tx
    );

    return {
      loan: { ...loan, approvalId: approval.id },
      approval,
      approvalId: approval.id,
    };
  });
}

export async function accrueLoanInterestForMonth(input: {
  loanId: string;
  year: number;
  month: number;
  adminId: string;
}) {
  if (!Number.isInteger(input.year) || input.month < 1 || input.month > 12) {
    throw new ServiceError(400, 'Invalid year or month');
  }
  const db = getDb();

  return db.transaction(async (tx: AppDb) => {
    const loanRows = await tx.select().from(loans).where(eq(loans.id, input.loanId)).limit(1);
    const loan = loanRows.at(0);
    if (!loan) throw new ServiceError(404, 'Loan not found');
    if (loan.status !== 'ACTIVE') {
      throw new ServiceError(409, 'Loan is not active');
    }

    const entries = await getCycleLedgerEntries(loan.cycleId, tx);
    const accruedPaise = calculateLoanAccruedInterestForMonth({
      loanId: loan.id,
      disbursedDate: loan.disbursedDate,
      principalPaise: loan.principalPaise,
      interestRateBps: loan.interestRateBps,
      interestMode: loan.interestMode,
      entries,
      year: input.year,
      month: input.month,
    });

    if (accruedPaise <= 0) {
      return { accruedPaise: 0, entry: null };
    }

    const lastDay = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
    const mm = String(input.month).padStart(2, '0');
    const monthEndIst = `${input.year}-${mm}-${String(lastDay).padStart(2, '0')}`;
    const idempKey = `accrual:${loan.id}:${input.year}-${mm}`;

    let entry = null;
    try {
      entry = await appendLedgerEntry(
        {
          cycleId: loan.cycleId,
          memberId: loan.memberId,
          loanId: loan.id,
          entryType: 'INTEREST_ACCRUAL',
          amountPaise: accruedPaise,
          effectiveDate: monthEndIst,
          reason: `Monthly interest accrual for ${input.year}-${mm}`,
          idempotencyKey: idempKey,
          createdByAdminId: input.adminId,
        },
        tx
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('unique') || msg.includes('duplicate')) {
        throw new ServiceError(409, 'Interest already accrued for this loan and month');
      }
      throw err;
    }

    await recordAuditEvent(
      {
        actorMemberId: input.adminId,
        actorRole: 'ADMIN',
        action: 'ACCRUE_LOAN_INTEREST',
        targetType: 'loan',
        targetId: loan.id,
        metadata: { year: input.year, month: input.month, accruedPaise },
      },
      tx
    );

    return { accruedPaise, entry };
  });
}

export async function repayLoan(input: {
  loanId: string;
  amountPaise?: number;
  interestPaidPaise?: number;
  principalPaidPaise?: number;
  effectiveDate: string;
  adminId: string;
}) {
  parseIstDateParts(input.effectiveDate);

  const db = getDb();
  return db.transaction(async (tx: AppDb) => {
    // Acquire row-level lock on the loan row to serialize concurrent repayments
    await tx.execute(sql`SELECT id FROM loans WHERE id = ${input.loanId} FOR UPDATE`);

    const loanRows = await tx.select().from(loans).where(eq(loans.id, input.loanId)).limit(1);
    const loan = loanRows.at(0);
    if (!loan) throw new ServiceError(404, 'Loan not found');
    if (loan.status !== 'ACTIVE') {
      throw new ServiceError(409, 'Loan is not active');
    }
    if (input.effectiveDate < loan.disbursedDate) {
      throw new ServiceError(400, 'Repayment date cannot precede loan disbursement date');
    }

    const entries = await getCycleLedgerEntries(loan.cycleId, tx);
    const balance = calculateLoanBalance({
      loanId: loan.id,
      disbursedDate: loan.disbursedDate,
      principalPaise: loan.principalPaise,
      interestRateBps: loan.interestRateBps,
      interestMode: loan.interestMode,
      entries,
      asOfDate: input.effectiveDate,
    });

    let allocation: { interestPaidPaise: number; principalPaidPaise: number };
    if (input.amountPaise !== undefined) {
      parseStrictPaise(input.amountPaise);
      try {
        allocation = allocateRepayment({
          paymentAmountPaise: input.amountPaise,
          outstandingPrincipalPaise: balance.outstandingPrincipalPaise,
          unpaidInterestPaise: balance.unpaidAccruedInterestPaise,
        });
      } catch (err) {
        throw new ServiceError(400, err instanceof Error ? err.message : 'Invalid repayment amount');
      }
    } else {
      const interestPaidPaise = input.interestPaidPaise ?? 0;
      const principalPaidPaise = input.principalPaidPaise ?? 0;
      if (interestPaidPaise < 0 || principalPaidPaise < 0) {
        throw new ServiceError(400, 'Payment amounts must be non-negative');
      }
      if (interestPaidPaise === 0 && principalPaidPaise === 0) {
        throw new ServiceError(400, 'Repayment must have positive interest or principal');
      }
      if (principalPaidPaise > balance.outstandingPrincipalPaise) {
        throw new ServiceError(400, 'Principal repayment cannot exceed outstanding principal');
      }
      allocation = { interestPaidPaise, principalPaidPaise };
    }

    const createdEntries = [];

    // Ensure any unposted accrued interest being paid is posted into the ledger
    if (allocation.interestPaidPaise > balance.unpaidPostedInterestPaise) {
      const accrualDelta = allocation.interestPaidPaise - balance.unpaidPostedInterestPaise;
      const accEntry = await appendLedgerEntry(
        {
          cycleId: loan.cycleId,
          memberId: loan.memberId,
          loanId: loan.id,
          entryType: 'INTEREST_ACCRUAL',
          amountPaise: accrualDelta,
          effectiveDate: input.effectiveDate,
          reason: 'Accrued interest up to repayment date',
          createdByAdminId: input.adminId,
        },
        tx
      );
      createdEntries.push(accEntry);
    }

    if (allocation.interestPaidPaise > 0) {
      const intEntry = await appendLedgerEntry(
        {
          cycleId: loan.cycleId,
          memberId: loan.memberId,
          loanId: loan.id,
          entryType: 'REPAYMENT_INTEREST',
          amountPaise: allocation.interestPaidPaise,
          effectiveDate: input.effectiveDate,
          reason: 'Loan interest repayment',
          createdByAdminId: input.adminId,
        },
        tx
      );
      createdEntries.push(intEntry);
    }

    if (allocation.principalPaidPaise > 0) {
      const prinEntry = await appendLedgerEntry(
        {
          cycleId: loan.cycleId,
          memberId: loan.memberId,
          loanId: loan.id,
          entryType: 'REPAYMENT_PRINCIPAL',
          amountPaise: allocation.principalPaidPaise,
          effectiveDate: input.effectiveDate,
          reason: 'Loan principal repayment',
          createdByAdminId: input.adminId,
        },
        tx
      );
      createdEntries.push(prinEntry);
    }

    const remainingPrincipalPaise =
      balance.outstandingPrincipalPaise - allocation.principalPaidPaise;
    const remainingInterestPaise =
      balance.unpaidAccruedInterestPaise - allocation.interestPaidPaise;

    const parts = input.effectiveDate.split('-');
    const y = Number(parts[0] ?? 2026);
    const m = Number(parts[1] ?? 1);
    const d = parts[2] ?? '01';
    let ny = y;
    let nm = m + 1;
    if (nm > 12) {
      ny += 1;
      nm = 1;
    }
    const nextDueDate = `${ny}-${String(nm).padStart(2, '0')}-${d.padStart(2, '0')}`;

    const newStatus =
      remainingPrincipalPaise === 0 && remainingInterestPaise <= 0 ? 'CLOSED' : 'ACTIVE';

    await tx
      .update(loans)
      .set({ status: newStatus, dueDate: nextDueDate })
      .where(eq(loans.id, loan.id));

    await recordAuditEvent(
      {
        actorMemberId: input.adminId,
        actorRole: 'ADMIN',
        action: 'REPAY_LOAN',
        targetType: 'loan',
        targetId: loan.id,
        metadata: {
          amountPaise: input.amountPaise,
          interestPaidPaise: allocation.interestPaidPaise,
          principalPaidPaise: allocation.principalPaidPaise,
          remainingPrincipalPaise,
        },
      },
      tx
    );

    const updatedLoan = {
      ...loan,
      outstandingPrincipalPaise: remainingPrincipalPaise,
      nextDueDate,
      status: newStatus,
    };

    return {
      loan: updatedLoan,
      interestPaidPaise: allocation.interestPaidPaise,
      principalPaidPaise: allocation.principalPaidPaise,
      remainingPrincipalPaise,
      entries: createdEntries,
    };
  });
}

