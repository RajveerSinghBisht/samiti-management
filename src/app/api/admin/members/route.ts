import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError, parseJsonBody } from '@/lib/http';
import { createMember, listMembers } from '@/lib/services/members';

const createMemberSchema = z.object({
  name: z.string().trim().min(2).max(100),
  mobile: z.string().trim().regex(/^\d{10}$/, 'Mobile must be 10 digits'),
  role: z.enum(['ADMIN', 'MEMBER']),
  initialSecret: z.string().min(4).max(128),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    const rows = await listMembers();
    return NextResponse.json({ members: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, createMemberSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const member = await createMember({
      ...parsed.data,
      adminId: auth.session.memberId,
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

