import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError, istDateSchema, parseJsonBody, uuidSchema } from '@/lib/http';
import { requestCycleClose } from '@/lib/services/cycles';

const closeSchema = z.object({
  asOfDate: istDateSchema,
  reason: z.string().trim().max(300).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid cycle ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(req, closeSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const approval = await requestCycleClose({
      cycleId: id,
      asOfDate: parsed.data.asOfDate,
      reason: parsed.data.reason,
      adminId: auth.session.memberId,
    });
    return NextResponse.json({ approval }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

