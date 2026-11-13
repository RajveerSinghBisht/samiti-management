import { NextResponse, type NextRequest } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { cycleMembers, cycles, getDb, loans, members } from '@/db';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { calculateGroupTotals, calculateLoanBalance } from '@/lib/calc';
import { handleApiError, uuidSchema } from '@/lib/http';
import { getCycleLedgerEntries } from '@/lib/services/ledger';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const cycleId = req.nextUrl.searchParams.get('cycleId');
  const month = req.nextUrl.searchParams.get('month'); // YYYY-MM

  if (!cycleId || !uuidSchema.safeParse(cycleId).success) {
    return NextResponse.json({ error: 'Valid cycleId is required' }, { status: 400 });
  }

  const db = getDb();
  try {
    const cycleRows = await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1);
    const cycle = cycleRows.at(0);
    if (!cycle) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
    }

    const enrolled = await db
      .select({ memberId: cycleMembers.memberId })
      .from(cycleMembers)
      .where(eq(cycleMembers.cycleId, cycleId));

    const enrolledIds = enrolled.map((e) => e.memberId);
    if (enrolledIds.length === 0) {
      return NextResponse.json({
        paidMembers: [],
        unpaidMembers: [],
        memberSummaries: [],
        groupTotals: calculateGroupTotals({
          entries: [],
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
          loans: [],
          asOfDate: '9999-12-31',
        }),
        poolAvailableToLendPaise: 0,
      });
    }

    const memberRows = await db
      .select({ id: members.id, name: members.name, mobile: members.mobile })
      .from(members)
      .where(inArray(members.id, enrolledIds));

    const entries = await getCycleLedgerEntries(cycleId);
    const cycleLoans = await db.select().from(loans).where(eq(loans.cycleId, cycleId));

    const asOfDate = month ? `${month}-31` : '9999-12-31';

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
      loans: cycleLoans.map((l) => ({
        id: l.id,
        memberId: l.memberId,
        disbursedDate: l.disbursedDate,
        principalPaise: l.principalPaise,
        interestRateBps: l.interestRateBps,
        interestMode: l.interestMode,
      })),
      asOfDate,
    });

    const paidMembers: string[] = [];
    const unpaidMembers: string[] = [];
    const memberSummaries = [];

    for (const m of memberRows) {
      const mEntries = entries.filter((e) => e.memberId === m.id);
      const contribEntriesThisMonth = mEntries.filter(
        (e) =>
          e.entryType === 'CONTRIBUTION' &&
          (month ? e.effectiveDate.startsWith(month) : true)
      );

      const contributionPaise = contribEntriesThisMonth.reduce(
        (acc, e) => acc + e.amountPaise,
        0
      );
      const paidContribution = contributionPaise > 0;

      if (paidContribution) {
        paidMembers.push(m.id);
      } else {
        unpaidMembers.push(m.id);
      }

      const mLoans = cycleLoans.filter((l) => l.memberId === m.id && l.status !== 'REJECTED');
      let loanPrincipalPendingPaise = 0;
      let interestStillDuePaise = 0;

      for (const ml of mLoans) {
        const bal = calculateLoanBalance({
          loanId: ml.id,
          disbursedDate: ml.disbursedDate,
          principalPaise: ml.principalPaise,
          interestRateBps: ml.interestRateBps,
          interestMode: ml.interestMode,
          entries,
          asOfDate,
        });
        loanPrincipalPendingPaise += bal.outstandingPrincipalPaise;
        interestStillDuePaise += bal.unpaidAccruedInterestPaise;
      }

      const interestPaidThisMonth = mEntries
        .filter(
          (e) =>
            e.entryType === 'REPAYMENT_INTEREST' &&
            (month ? e.effectiveDate.startsWith(month) : true)
        )
        .reduce((acc, e) => acc + e.amountPaise, 0);

      const remainingBalancePaise = loanPrincipalPendingPaise + interestStillDuePaise;

      memberSummaries.push({
        memberId: m.id,
        memberName: m.name,
        paidContribution,
        contributionPaise,
        loanPrincipalPendingPaise,
        interestPaidThisMonthPaise: interestPaidThisMonth,
        interestStillDuePaise,
        remainingBalancePaise,
      });
    }

    return NextResponse.json({
      cycleId,
      month: month || null,
      paidMembers,
      unpaidMembers,
      memberSummaries,
      groupTotals,
      poolAvailableToLendPaise: groupTotals.poolAvailableToLendPaise,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

