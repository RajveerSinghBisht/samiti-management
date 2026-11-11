import React from 'react';
import { listCycles } from '@/lib/services/cycles';
import { listLoans } from '@/lib/services/loans';
import { listMembers } from '@/lib/services/members';
import { AdminLoansClient } from '@/components/admin/AdminLoansClient';

export const dynamic = 'force-dynamic';

export default async function AdminLoansPage() {
  const [cycles, members, loans] = await Promise.all([
    listCycles(),
    listMembers(),
    listLoans(),
  ]);
  return (
    <AdminLoansClient
      initialCycles={cycles}
      initialMembers={members}
      initialLoans={loans}
    />
  );
}
