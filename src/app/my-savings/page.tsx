import React from 'react';
import { requireMemberPageSession } from '@/app/_auth/page-session';
import { getMemberPortalData } from '@/lib/services/member-portal';
import { MemberSavingsView } from '@/components/member/MemberPortalViews';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'My Savings | Samiti',
};

export default async function MemberSavingsPage() {
  const session = await requireMemberPageSession();
  const data = await getMemberPortalData(session.memberId);
  return (
    <MemberSavingsView
      user={{ name: session.name, mobile: session.mobile, role: 'MEMBER' }}
      data={data}
    />
  );
}

