import React from 'react';
import { getActiveCycle } from '@/lib/services/cycles';
import { getDb, members } from '@/db';
import { eq } from 'drizzle-orm';
import { GoodCauseClient } from '@/components/admin/GoodCauseClient';

export const dynamic = 'force-dynamic';

export default async function GoodCausePage() {
  const cycle = await getActiveCycle();
  if (!cycle) {
    return (
      <div className="p-6 bg-amber-50 border-2 border-amber-300 rounded-xl">
        <h1 className="text-2xl font-bold text-amber-900">No Active Cycle</h1>
        <p className="text-lg text-amber-800 mt-2">
          An active cycle is required to issue a Good Cause Grant from the interest pool.
        </p>
      </div>
    );
  }

  const db = getDb();
  const cycleMembers = await db
    .select({
      id: members.id,
      name: members.name,
      mobile: members.mobile,
    })
    .from(members)
    .where(eq(members.status, 'ACTIVE'));

  return <GoodCauseClient cycle={{ id: cycle.id, name: cycle.name }} members={cycleMembers} />;
}

