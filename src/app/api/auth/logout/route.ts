import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  deleteSessionByRawToken,
  isSecureCookieContext,
} from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, {
    allowMustChangePin: true,
    allowUnverifiedTotp: true,
    requireCsrf: true,
  });
  if ('errorResponse' in auth) return auth.errorResponse;

  await deleteSessionByRawToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res, isSecureCookieContext(req));
  return res;
}

