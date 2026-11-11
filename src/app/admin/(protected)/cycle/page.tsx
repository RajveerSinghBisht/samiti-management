import React from 'react';
import { listCycles } from '@/lib/services/cycles';
import { AdminCycleClient } from '@/components/admin/AdminCycleClient';

export const dynamic = 'force-dynamic';

export default async function AdminCyclePage() {
  const rows = await listCycles();
  return <AdminCycleClient initialCycles={rows} />;
}
