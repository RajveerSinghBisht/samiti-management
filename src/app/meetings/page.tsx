import React from 'react';
import { requireMemberPageSession } from '@/app/_auth/page-session';
import { getMemberPortalData } from '@/lib/services/member-portal';
import { MemberMeetingsView } from '@/components/member/MemberPortalViews';

export const dynamic = 'force-dynamic';

export default async function MemberMeetingsPage() {
  const session = await requireMemberPageSession();
  const data = await getMemberPortalData(session.memberId);
  return (
    <MemberMeetingsView
      user={{ name: session.name, mobile: session.mobile, role: 'MEMBER' }}
      data={data}
    />
  );
}

