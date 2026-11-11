import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError } from '@/lib/http';
import { listApprovals } from '@/lib/services/approvals';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    const rows = await listApprovals();
    return NextResponse.json({ approvals: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

