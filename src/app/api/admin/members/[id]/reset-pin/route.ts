import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError, parseJsonBody, uuidSchema } from '@/lib/http';
import { resetMemberPin } from '@/lib/services/members';

const resetPinSchema = z
  .object({
    newPin: z.string().trim().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits').optional(),
  })
  .default({});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid member ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(req, resetPinSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const result = await resetMemberPin({
      id,
      newPin: parsed.data.newPin,
      adminId: auth.session.memberId,
    });
    return NextResponse.json({ ok: true, mustChangePin: true, temporaryPin: result.temporaryPin });
  } catch (err) {
    return handleApiError(err);
  }
}

