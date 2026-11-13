import React from 'react';
import { requireMemberPageSession } from '@/app/_auth/page-session';
import { getMemberPortalData } from '@/lib/services/member-portal';
import { MemberHomeView } from '@/components/member/MemberPortalViews';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Member Home | Samiti',
};

export default async function MemberHomePage() {
  const session = await requireMemberPageSession();
  const data = await getMemberPortalData(session.memberId);
  return (
    <MemberHomeView
      user={{ name: session.name, mobile: session.mobile, role: 'MEMBER' }}
      data={data}
    />
  );
}

