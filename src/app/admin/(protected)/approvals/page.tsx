import React from 'react';
import { requireAdminPageSession } from '@/app/_auth/page-session';
import { listApprovals } from '@/lib/services/approvals';
import { AdminApprovalsClient } from '@/components/admin/AdminApprovalsClient';

export const dynamic = 'force-dynamic';

export default async function AdminApprovalsPage() {
  const [session, approvals] = await Promise.all([
    requireAdminPageSession(),
    listApprovals(),
  ]);
  return (
    <AdminApprovalsClient
      initialApprovals={approvals}
      currentUserId={session.memberId}
    />
  );
}
