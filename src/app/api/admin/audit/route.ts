import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError } from '@/lib/http';
import { listAuditEvents } from '@/lib/services/audit';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    const events = await listAuditEvents();
    return NextResponse.json({ events });
  } catch (err) {
    return handleApiError(err);
  }
}

