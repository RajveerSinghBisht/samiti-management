import React from 'react';
import { listMembers } from '@/lib/services/members';
import { AdminMembersClient } from '@/components/admin/AdminMembersClient';

export const dynamic = 'force-dynamic';

export default async function AdminMembersPage() {
  const rows = await listMembers();
  return <AdminMembersClient initialMembers={rows} />;
}
