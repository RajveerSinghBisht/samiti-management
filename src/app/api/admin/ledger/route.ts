import { desc, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { getDb, ledgerEntries, members } from '@/db';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError } from '@/lib/http';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    const db = getDb();
    const cycleId = req.nextUrl.searchParams.get('cycleId');
    const rows = cycleId
      ? await db
          .select()
          .from(ledgerEntries)
          .where(eq(ledgerEntries.cycleId, cycleId))
          .orderBy(desc(ledgerEntries.createdAt))
          .limit(200)
      : await db
          .select()
          .from(ledgerEntries)
          .orderBy(desc(ledgerEntries.createdAt))
          .limit(200);

    const memberRows = await db
      .select({ id: members.id, name: members.name })
      .from(members);
    const memberMap = new Map(memberRows.map((m) => [m.id, m.name]));

    const reversedSet = new Set(
      rows.filter((r) => r.entryType === 'REVERSAL' && r.reversesEntryId).map((r) => r.reversesEntryId!)
    );

    return NextResponse.json({
      entries: rows.map((r) => ({
        ...r,
        memberName: r.memberId ? (memberMap.get(r.memberId) ?? null) : null,
        isReversed: reversedSet.has(r.id),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

