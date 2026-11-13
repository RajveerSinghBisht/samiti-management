import React from 'react';
import { getDb, members, loans } from '@/db';
import { eq } from 'drizzle-orm';
import { getActiveCycle } from '@/lib/services/cycles';
import { ConductMeetingClient } from '@/components/admin/ConductMeetingClient';

export const dynamic = 'force-dynamic';

export default async function ConductMeetingPage() {
  const cycle = await getActiveCycle();
  if (!cycle) {
    return (
      <div className="p-6 bg-amber-50 border-2 border-amber-300 rounded-xl">
        <h1 className="text-2xl font-bold text-amber-900">No Active Cycle</h1>
        <p className="text-lg text-amber-800 mt-2">
          An active cycle is required before you can conduct a monthly meeting.
        </p>
      </div>
    );
  }

  const db = getDb();
  const cycleMemberList = await db
    .select({
      id: members.id,
      name: members.name,
      mobile: members.mobile,
    })
    .from(members)
    .where(eq(members.status, 'ACTIVE'));

  const activeLoans = await db
    .select()
    .from(loans)
    .where(eq(loans.cycleId, cycle.id));

  return (
    <ConductMeetingClient
      cycle={{
        id: cycle.id,
        name: cycle.name,
        monthlyContributionPaise: cycle.monthlyContributionPaise,
        interestRateBps: cycle.interestRateBps,
        normalLoanCapPaise: cycle.normalLoanCapPaise,
        emergencyLoanCapPaise: cycle.emergencyLoanCapPaise,
      }}
      members={cycleMemberList}
      loans={activeLoans.filter((l) => l.status === 'ACTIVE').map((l) => ({
        id: l.id,
        memberId: l.memberId,
        principalPaise: l.principalPaise,
        repaymentMode: l.repaymentMode,
      }))}
    />
  );
}

