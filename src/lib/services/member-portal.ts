import { and, asc, eq } from 'drizzle-orm';
import { getDb, loans } from '@/db';
import {
  calculateGroupTotals,
  calculateLoanBalance,
  calculateMemberSavings,
  resolveActiveEntries,
} from '@/lib/calc';
import { toIstDateString } from '@/lib/dates';
import { getActiveCycle, listCycles } from './cycles';
import { getCycleLedgerEntries } from './ledger';
import { listMeetings } from './meetings';

export async function getMemberPortalData(memberId: string) {
  const db = getDb();
  const activeCycle = await getActiveCycle();
  const cycle = activeCycle ?? (await listCycles()).at(0) ?? null;
  const today = toIstDateString();

  if (!cycle) {
    return {
      cycle: null,
      savings: {
        totalContributedPaise: 0,
        totalSharePayoutPaise: 0,
        totalRotationReceivedPaise: 0,
        contributionCount: 0,
      },
      myLoans: [],
      myContributionEntries: [],
      myLoanEntries: [],
      groupTotals: {
        totalContributionsPaise: 0,
        totalLoansDisbursedPaise: 0,
        totalPrincipalRepaidPaise: 0,
        totalOutstandingPrincipalPaise: 0,
        totalInterestCollectedPaise: 0,
        totalRotationPayoutsPaise: 0,
        totalSharePayoutsPaise: 0,
        treasurerCashOnHandPaise: 0,
        totalPoolEquityPaise: 0,
      },
      meetings: [],
    };
  }

  const entries = await getCycleLedgerEntries(cycle.id, db);
  const activeEntries = resolveActiveEntries(entries);
  const savings = calculateMemberSavings(entries, memberId);

  const myLoanRows = await db
    .select()
    .from(loans)
    .where(and(eq(loans.cycleId, cycle.id), eq(loans.memberId, memberId)))
    .orderBy(asc(loans.createdAt));

  const allCycleLoans = await db.select().from(loans).where(eq(loans.cycleId, cycle.id));

  const myLoans = myLoanRows.map((loan) => ({
    id: loan.id,
    principalPaise: loan.principalPaise,
    interestRateBps: loan.interestRateBps,
    interestMode: loan.interestMode,
    disbursedDate: loan.disbursedDate,
    status: loan.status,
    note: loan.note,
    balance: calculateLoanBalance({
      loanId: loan.id,
      disbursedDate: loan.disbursedDate,
      principalPaise: loan.principalPaise,
      interestRateBps: loan.interestRateBps,
      interestMode: loan.interestMode,
      entries,
      asOfDate: today,
    }),
  }));

  const myContributionEntries = activeEntries.filter(
    (e) =>
      e.memberId === memberId &&
      (e.entryType === 'CONTRIBUTION' ||
        e.entryType === 'SHARE_PAYOUT' ||
        e.entryType === 'ROTATION_PAYOUT')
  );

  const myLoanEntries = activeEntries.filter(
    (e) =>
      e.memberId === memberId &&
      (e.entryType === 'LOAN_DISBURSEMENT' ||
        e.entryType === 'REPAYMENT_PRINCIPAL' ||
        e.entryType === 'REPAYMENT_INTEREST' ||
        e.entryType === 'INTEREST_ACCRUAL')
  );

  const groupTotals = calculateGroupTotals({
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
    loans: allCycleLoans.map((l) => ({
      id: l.id,
      memberId: l.memberId,
      disbursedDate: l.disbursedDate,
      principalPaise: l.principalPaise,
      interestRateBps: l.interestRateBps,
      interestMode: l.interestMode,
    })),
    asOfDate: today,
  });

  const cycleMeetings = await listMeetings(cycle.id);

  return {
    cycle: {
      id: cycle.id,
      name: cycle.name,
      startDate: cycle.startDate,
      lengthMonths: cycle.lengthMonths,
      monthlyContributionPaise: cycle.monthlyContributionPaise,
      interestRateBps: cycle.interestRateBps,
      interestMode: cycle.interestMode,
      interestSharingMode: cycle.interestSharingMode,
      rotationPayoutEnabled: cycle.rotationPayoutEnabled,
      status: cycle.status,
    },
    savings,
    myLoans,
    myContributionEntries,
    myLoanEntries,
    groupTotals,
    meetings: cycleMeetings.map((mt) => ({
      id: mt.id,
      meetingDate: mt.meetingDate,
      place: mt.place,
      hostName: mt.hostName,
      notes: mt.notes,
    })),
  };
}

