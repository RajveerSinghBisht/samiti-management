import { and, desc, eq } from 'drizzle-orm';
import {
  approvals,
  contributionSchedule,
  cycleMembers,
  cycles,
  getDb,
  loans,
  members,
} from '@/db';
import { calculateLoanBalance } from '@/lib/calc';
import { addMonthsIst, parseIstDateParts } from '@/lib/dates';
import { parseStrictPaise } from '@/lib/money';
import { recordAuditEvent } from './audit';
import { ServiceError } from './errors';
import { getCycleLedgerEntries } from './ledger';

export async function listCycles() {
  const db = getDb();
  return db.select().from(cycles).orderBy(desc(cycles.createdAt));
}

export async function getActiveCycle() {
  const db = getDb();
  const rows = await db
    .select()
    .from(cycles)
    .where(eq(cycles.status, 'ACTIVE'))
    .orderBy(desc(cycles.createdAt))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function createCycle(input: {
  name: string;
  startDate: string;
  lengthMonths: number;
  monthlyContributionPaise: number;
  interestRateBps: number;
  interestMode: 'REDUCING_BALANCE' | 'FLAT';
  interestSharingMode: 'PROPORTIONAL_CONTRIBUTION' | 'EQUAL';
  rotationPayoutEnabled?: boolean;
  lateRuleMode?: 'NONE' | 'FIXED_PAISA' | 'PERCENT_BPS';
  lateRuleValue?: number;
  normalLoanCapPaise?: number;
  emergencyLoanCapPaise?: number;
  meetingDayOfMonth?: number;
  adminId: string;
}) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 100) {
    throw new ServiceError(400, 'Cycle name must be 2 to 100 characters');
  }
  parseIstDateParts(input.startDate);
  if (!Number.isSafeInteger(input.lengthMonths) || input.lengthMonths <= 0 || input.lengthMonths > 120) {
    throw new ServiceError(400, 'Cycle lengthMonths must be a positive integer (1..120)');
  }
  parseStrictPaise(input.monthlyContributionPaise);
  if (!Number.isSafeInteger(input.interestRateBps) || input.interestRateBps < 0 || input.interestRateBps > 5000) {
    throw new ServiceError(400, 'interestRateBps must be between 0 and 5000');
  }
  const lateRuleMode = input.lateRuleMode ?? 'NONE';
  const lateRuleValue = input.lateRuleValue ?? 0;
  if (!Number.isSafeInteger(lateRuleValue) || lateRuleValue < 0) {
    throw new ServiceError(400, 'lateRuleValue must be a non-negative integer');
  }

  const normalLoanCapPaise = input.normalLoanCapPaise ?? 5_000_000;
  const emergencyLoanCapPaise = input.emergencyLoanCapPaise ?? 10_000_000;
  const meetingDayOfMonth = input.meetingDayOfMonth ?? 10;
  const rotationPayoutEnabled = Boolean(input.rotationPayoutEnabled);

  const db = getDb();
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(cycles)
      .values({
        name,
        startDate: input.startDate,
        lengthMonths: input.lengthMonths,
        monthlyContributionPaise: input.monthlyContributionPaise,
        interestRateBps: input.interestRateBps,
        interestMode: input.interestMode,
        interestSharingMode: input.interestSharingMode,
        rotationPayoutEnabled,
        normalLoanCapPaise,
        emergencyLoanCapPaise,
        meetingDayOfMonth,
        lateRuleMode,
        lateRuleValue,
        status: 'ACTIVE',
        createdByAdminId: input.adminId,
      })
      .returning();

    const cycle = inserted.at(0);
    if (!cycle) {
      throw new ServiceError(500, 'Failed to create cycle');
    }

    const activeMembers = await tx
      .select()
      .from(members)
      .where(and(eq(members.role, 'MEMBER'), eq(members.status, 'ACTIVE')));

    let order = 1;
    for (const m of activeMembers) {
      await tx.insert(cycleMembers).values({
        cycleId: cycle.id,
        memberId: m.id,
        joinedMonthIndex: 1,
        rotationOrder: order,
        status: 'ACTIVE',
      });
      order += 1;

      const scheduleRows = [];
      for (let monthIdx = 1; monthIdx <= cycle.lengthMonths; monthIdx++) {
        scheduleRows.push({
          cycleId: cycle.id,
          memberId: m.id,
          monthIndex: monthIdx,
          dueDate: addMonthsIst(cycle.startDate, monthIdx - 1),
          expectedAmountPaise: cycle.monthlyContributionPaise,
          status: 'PENDING' as const,
        });
      }
      if (scheduleRows.length > 0) {
        await tx.insert(contributionSchedule).values(scheduleRows);
      }
    }

    await recordAuditEvent(
      {
        actorMemberId: input.adminId,
        actorRole: 'ADMIN',
        action: 'CREATE_CYCLE',
        targetType: 'cycle',
        targetId: cycle.id,
        metadata: {
          name: cycle.name,
          lengthMonths: cycle.lengthMonths,
          monthlyContributionPaise: cycle.monthlyContributionPaise,
          interestRateBps: cycle.interestRateBps,
        },
      },
      tx
    );

    return cycle;
  });
}

export async function requestCycleClose(input: {
  cycleId: string;
  asOfDate: string;
  reason?: string;
  adminId: string;
}) {
  parseIstDateParts(input.asOfDate);
  const db = getDb();

  const cycleRows = await db.select().from(cycles).where(eq(cycles.id, input.cycleId)).limit(1);
  const cycle = cycleRows.at(0);
  if (!cycle) {
    throw new ServiceError(404, 'Cycle not found');
  }
  if (cycle.status !== 'ACTIVE') {
    throw new ServiceError(409, 'Cycle is already closed');
  }

  const cycleLoans = await db.select().from(loans).where(eq(loans.cycleId, cycle.id));
  const entries = await getCycleLedgerEntries(cycle.id, db);

  for (const loan of cycleLoans) {
    if (loan.status === 'PENDING_APPROVAL') {
      throw new ServiceError(409, 'Cannot close cycle while loans are pending approval');
    }
    if (loan.status === 'ACTIVE') {
      const bal = calculateLoanBalance({
        loanId: loan.id,
        disbursedDate: loan.disbursedDate,
        principalPaise: loan.principalPaise,
        interestRateBps: loan.interestRateBps,
        interestMode: loan.interestMode,
        entries,
        asOfDate: input.asOfDate,
      });
      if (bal.outstandingPrincipalPaise > 0 || bal.unpaidAccruedInterestPaise > 0) {
        throw new ServiceError(409, 'Cannot close cycle while loans remain open or unpaid');
      }
    }
  }

  const inserted = await db
    .insert(approvals)
    .values({
      cycleId: cycle.id,
      actionType: 'CYCLE_CLOSE',
      targetId: cycle.id,
      amountPaise: 0,
      payloadJson: {
        asOfDate: input.asOfDate,
        reason: input.reason || 'End of cycle close',
      },
      reason: input.reason || 'End of cycle close',
      status: 'PENDING',
      requestedByAdminId: input.adminId,
    })
    .returning();

  const approval = inserted.at(0);
  if (!approval) {
    throw new ServiceError(500, 'Failed to create cycle close approval request');
  }

  await recordAuditEvent({
    actorMemberId: input.adminId,
    actorRole: 'ADMIN',
    action: 'REQUEST_CYCLE_CLOSE',
    targetType: 'cycle',
    targetId: cycle.id,
    metadata: { approvalId: approval.id, asOfDate: input.asOfDate },
  });

  return approval;
}

