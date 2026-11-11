import React from 'react';
import { listCycles } from '@/lib/services/cycles';
import { listMembers } from '@/lib/services/members';
import { listMeetings } from '@/lib/services/meetings';
import { AdminMeetingsClient } from '@/components/admin/AdminMeetingsClient';

export const dynamic = 'force-dynamic';

export default async function AdminMeetingsPage() {
  const [cycles, members, meetings] = await Promise.all([
    listCycles(),
    listMembers(),
    listMeetings(),
  ]);
  return (
    <AdminMeetingsClient
      initialCycles={cycles}
      initialMembers={members}
      initialMeetings={meetings}
    />
  );
}
