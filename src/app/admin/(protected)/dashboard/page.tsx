import React from 'react';
import { getActiveCycle } from '@/lib/services/cycles';
import { MonthlyDashboardClient } from '@/components/admin/MonthlyDashboardClient';

export const dynamic = 'force-dynamic';

export default async function AdminMonthlyDashboardPage() {
  const cycle = await getActiveCycle();
  return <MonthlyDashboardClient initialCycleId={cycle?.id ?? null} initialCycleName={cycle?.name ?? null} />;
}

