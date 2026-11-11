import { NextResponse, type NextRequest } from 'next/server';
import { generateRandomToken } from '@/lib/auth/crypto';
import {
  PRE_CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  getSessionByRawToken,
  isSecureCookieContext,
} from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionByRawToken(sessionToken);
  if (session) {
    return NextResponse.json({ csrfToken: session.csrfToken });
  }

  const existingPreCsrf = req.cookies.get(PRE_CSRF_COOKIE_NAME)?.value;
  const csrfToken =
    existingPreCsrf && existingPreCsrf.length >= 16 ? existingPreCsrf : generateRandomToken(32);

  const res = NextResponse.json({ csrfToken });
  res.cookies.set(PRE_CSRF_COOKIE_NAME, csrfToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookieContext(req),
    path: '/',
    maxAge: 60 * 60,
  });
  return res;
}

