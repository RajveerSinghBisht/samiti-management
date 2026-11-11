import React from 'react';
import { requireAdminPageSession } from '@/app/_auth/page-session';
import { AppShell } from '@/components/AppShell';

export const dynamic = 'force-dynamic';

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdminPageSession();
  return (
    <AppShell user={{ name: session.name, role: 'ADMIN', totpVerified: true }}>
      {children}
    </AppShell>
  );
}

