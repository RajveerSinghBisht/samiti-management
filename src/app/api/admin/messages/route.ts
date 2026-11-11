import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError } from '@/lib/http';
import { listMessageLogs } from '@/lib/services/messaging';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    const messages = await listMessageLogs();
    return NextResponse.json({ messages });
  } catch (err) {
    return handleApiError(err);
  }
}

