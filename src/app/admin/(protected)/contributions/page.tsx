import React from 'react';
import { resolveActiveEntries } from '@/lib/calc';
import { getActiveCycle } from '@/lib/services/cycles';
import { getCycleLedgerEntries } from '@/lib/services/ledger';
import { listMembers } from '@/lib/services/members';
import { AdminContributionsClient } from '@/components/admin/AdminContributionsClient';

export const dynamic = 'force-dynamic';

export default async function AdminContributionsPage() {
  const cycle = await getActiveCycle();
  if (!cycle) {
    return (
      <AdminContributionsClient
        initialCycle={null}
        initialMembers={[]}
        initialContributions={[]}
      />
    );
  }

  const allMembers = await listMembers();
  const memberRows = allMembers.filter((m) => m.role === 'MEMBER');
  const entries = await getCycleLedgerEntries(cycle.id);
  const activeContribs = resolveActiveEntries(entries).filter(
    (e) => e.entryType === 'CONTRIBUTION'
  );

  return (
    <AdminContributionsClient
      initialCycle={{
        id: cycle.id,
        name: cycle.name,
        lengthMonths: cycle.lengthMonths,
        monthlyContributionPaise: cycle.monthlyContributionPaise,
      }}
      initialMembers={memberRows.map((m) => ({
        id: m.id,
        name: m.name,
        mobile: m.mobile,
      }))}
      initialContributions={activeContribs}
    />
  );
}
