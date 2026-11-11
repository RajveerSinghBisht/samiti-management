import React from 'react';
import { desc } from 'drizzle-orm';
import { getDb, ledgerEntries, members } from '@/db';
import { AdminCorrectionsClient } from '@/components/admin/AdminCorrectionsClient';

export const dynamic = 'force-dynamic';

export default async function AdminCorrectionsPage() {
  const db = getDb();
  const [rows, memberRows] = await Promise.all([
    db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.createdAt)).limit(200),
    db.select({ id: members.id, name: members.name }).from(members),
  ]);
  const memberMap = new Map(memberRows.map((m) => [m.id, m.name]));
  const reversedSet = new Set(
    rows
      .filter((r) => r.entryType === 'REVERSAL' && r.reversesEntryId)
      .map((r) => r.reversesEntryId!)
  );

  const initialEntries = rows.map((r) => ({
    id: r.id,
    entryType: r.entryType,
    amountPaise: r.amountPaise,
    effectiveDate: r.effectiveDate,
    memberName: r.memberId ? (memberMap.get(r.memberId) ?? null) : null,
    reason: r.reason,
    isReversed: reversedSet.has(r.id),
  }));

  return <AdminCorrectionsClient initialEntries={initialEntries} />;
}
