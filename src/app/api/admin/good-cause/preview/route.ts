import { NextResponse, type NextRequest } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { cycleMembers, getDb, members } from '@/db';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError, parseJsonBody, strictPositiveIntSchema, uuidSchema } from '@/lib/http';
import { splitLargestRemainder } from '@/lib/money';

const previewSchema = z.object({
  cycleId: uuidSchema,
  amountPaise: strictPositiveIntSchema,
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, previewSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  const db = getDb();
  try {
    const enrolled = await db
      .select({ memberId: cycleMembers.memberId })
      .from(cycleMembers)
      .where(eq(cycleMembers.cycleId, parsed.data.cycleId));

    if (enrolled.length === 0) {
      return NextResponse.json({ error: 'No members in cycle' }, { status: 400 });
    }

    const memberRows = await db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(inArray(members.id, enrolled.map((e) => e.memberId)));

    const memberMap = new Map(memberRows.map((m) => [m.id, m.name]));

    const weights = memberRows.map((m) => ({
      id: m.id,
      weight: 1,
    }));

    const split = splitLargestRemainder(parsed.data.amountPaise, weights);

    const memberReductions = split.map((s) => ({
      memberId: s.id,
      memberName: memberMap.get(s.id) || 'Unknown',
      reductionPaise: s.amountPaise,
    }));

    return NextResponse.json({
      amountPaise: parsed.data.amountPaise,
      memberReductions,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

