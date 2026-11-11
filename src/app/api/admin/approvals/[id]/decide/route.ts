import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError, parseJsonBody, uuidSchema } from '@/lib/http';
import { decideApproval } from '@/lib/services/approvals';

const decideSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
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
    return NextResponse.json({ error: 'Invalid approval ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(req, decideSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const res = await decideApproval({
      approvalId: id,
      decision: parsed.data.decision,
      decisionReason: parsed.data.reason,
      adminId: auth.session.memberId,
    });
    return NextResponse.json(res);
  } catch (err) {
    return handleApiError(err);
  }
}

