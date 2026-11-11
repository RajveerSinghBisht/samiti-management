import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError, istDateSchema, parseJsonBody, uuidSchema } from '@/lib/http';
import { createMeeting, listMeetings } from '@/lib/services/meetings';

const createMeetingSchema = z.object({
  cycleId: uuidSchema,
  meetingDate: istDateSchema,
  hostMemberId: uuidSchema.nullable().optional(),
  place: z.string().trim().min(2).max(300),
  notes: z.string().trim().max(500).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    const cycleId = req.nextUrl.searchParams.get('cycleId') || undefined;
    const rows = await listMeetings(cycleId);
    return NextResponse.json({ meetings: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, createMeetingSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const meeting = await createMeeting({
      ...parsed.data,
      adminId: auth.session.memberId,
    });
    return NextResponse.json({ meeting }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

