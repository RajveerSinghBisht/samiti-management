import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError, parseJsonBody, uuidSchema } from '@/lib/http';
import { updateMember } from '@/lib/services/members';

const patchMemberSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid member ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(req, patchMemberSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const member = await updateMember({
      id,
      name: parsed.data.name,
      status: parsed.data.status,
      adminId: auth.session.memberId,
    });
    return NextResponse.json({ member });
  } catch (err) {
    return handleApiError(err);
  }
}

