import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError, parseJsonBody, uuidSchema } from '@/lib/http';
import { closeMeeting } from '@/lib/services/meetings';

const closeMeetingSchema = z.object({
  summaryNote: z.string().trim().max(1000).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid meeting ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(req, closeMeetingSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const result = await closeMeeting({
      meetingId: id,
      summaryNote: parsed.data.summaryNote,
      adminId: auth.session.memberId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}

