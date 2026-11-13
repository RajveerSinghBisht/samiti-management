import { NextResponse, type NextRequest } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { cycleMembers, cycles, getDb, loans, members } from '@/db';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { calculateGroupTotals, calculateLoanBalance, calculateMemberSavings } from '@/lib/calc';
import { toIstDateString } from '@/lib/dates';
import { handleApiError, uuidSchema } from '@/lib/http';
import { splitLargestRemainder } from '@/lib/money';
import { getCycleLedgerEntries } from '@/lib/services/ledger';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const cycleId = req.nextUrl.searchParams.get('cycleId');
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
    const memberRows =
      enrolledIds.length > 0
        ? await db
            .select({ id: members.id, name: members.name })
            .from(members)
            .where(inArray(members.id, enrolledIds))
        : [];

    const entries = await getCycleLedgerEntries(cycleId);
    const cycleLoans = await db.select().from(loans).where(eq(loans.cycleId, cycleId));
    const asOfDate = toIstDateString();

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
      asOfDate,
    });

    const netInterestPoolPaise = Math.max(
      0,
      totals.totalInterestCollectedPaise +
        totals.totalBankInterestPaise -
        totals.totalGoodCauseGrantsPaise
    );

    const weights = memberRows.map((m) => ({ id: m.id, weight: 1 }));
    const interestShares = splitLargestRemainder(netInterestPoolPaise, weights);
    const shareMap = new Map(interestShares.map((s) => [s.id, s.amountPaise]));

    const memberSettlements = memberRows.map((m) => {
      const savings = calculateMemberSavings(entries, m.id, asOfDate);
      const mLoans = cycleLoans.filter((l) => l.memberId === m.id && l.status !== 'REJECTED');

      let unpaidPrincipalPaise = 0;
      let unpaidInterestPaise = 0;

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
        unpaidPrincipalPaise += bal.outstandingPrincipalPaise;
        unpaidInterestPaise += bal.unpaidAccruedInterestPaise;
      }

      const interestSharePaise = shareMap.get(m.id) || 0;
      const netSettlementPaise =
        savings.totalContributedPaise +
        interestSharePaise -
        unpaidPrincipalPaise -
        unpaidInterestPaise;

      return {
        memberId: m.id,
        memberName: m.name,
        contributionsPaidPaise: savings.totalContributedPaise,
        interestSharePaise,
        unpaidPrincipalPaise,
        unpaidInterestPaise,
        netSettlementPaise,
      };
    });

    return NextResponse.json({
      cycleId,
      asOfDate,
      totalContributionsPaise: totals.totalContributionsPaise,
      totalInterestCollectedPaise: totals.totalInterestCollectedPaise,
      totalBankInterestPaise: totals.totalBankInterestPaise,
      totalGoodCauseGrantsPaise: totals.totalGoodCauseGrantsPaise,
      netInterestPoolPaise,
      memberSettlements,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

