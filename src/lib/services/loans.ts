import { desc, eq, sql } from 'drizzle-orm';
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
  disbursedDate: string;
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

    const insertedLoans = await tx
      .insert(loans)
      .values({
        cycleId: cycle.id,
        memberId: member.id,
        principalPaise: input.principalPaise,
        interestRateBps: cycle.interestRateBps,
        interestMode: cycle.interestMode,
        disbursedDate: input.disbursedDate,
        status: 'PENDING_APPROVAL',
        note: input.note?.trim() || null,
        requestedByAdminId: input.adminId,
      })
      .returning();

    const loan = insertedLoans.at(0);
    if (!loan) throw new ServiceError(500, 'Failed to create loan');

    const insertedApprovals = await tx
      .insert(approvals)
      .values({
        cycleId: cycle.id,
        actionType: 'LOAN_APPROVAL',
        targetId: loan.id,
        amountPaise: loan.principalPaise,
        payloadJson: {
          loanId: loan.id,
          memberId: member.id,
          memberName: member.name,
          principalPaise: loan.principalPaise,
          disbursedDate: loan.disbursedDate,
        },
        reason: input.note?.trim() || 'Loan approval request',
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

    return { loan: { ...loan, approvalId: approval.id }, approval };
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
  amountPaise: number;
  effectiveDate: string;
  adminId: string;
}) {
  parseStrictPaise(input.amountPaise);
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

    let allocation;
    try {
      allocation = allocateRepayment({
        paymentAmountPaise: input.amountPaise,
        outstandingPrincipalPaise: balance.outstandingPrincipalPaise,
        unpaidInterestPaise: balance.unpaidAccruedInterestPaise,
      });
    } catch (err) {
      throw new ServiceError(400, err instanceof Error ? err.message : 'Invalid repayment amount');
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

    if (remainingPrincipalPaise === 0 && remainingInterestPaise === 0) {
      await tx.update(loans).set({ status: 'CLOSED' }).where(eq(loans.id, loan.id));
    }

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

    return {
      interestPaidPaise: allocation.interestPaidPaise,
      principalPaidPaise: allocation.principalPaidPaise,
      remainingPrincipalPaise,
      entries: createdEntries,
    };
  });
}

