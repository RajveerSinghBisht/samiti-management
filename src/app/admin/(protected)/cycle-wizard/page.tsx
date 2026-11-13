import React from 'react';
import { getDb, members } from '@/db';
import { listCycles } from '@/lib/services/cycles';
import { CycleWizardClient } from '@/components/admin/CycleWizardClient';

export const dynamic = 'force-dynamic';

export default async function CycleWizardPage() {
  const db = getDb();
  const allMembers = await db
    .select({
      id: members.id,
      name: members.name,
      mobile: members.mobile,
      role: members.role,
    })
    .from(members);

  const adminList = allMembers.filter((m) => m.role === 'ADMIN');
  const regularMembers = allMembers.filter((m) => m.role === 'MEMBER');

  const existingCycles = await listCycles();

  return (
    <CycleWizardClient
      admins={adminList}
      existingMembers={regularMembers}
      hasExistingCycles={existingCycles.length > 0}
    />
  );
}
