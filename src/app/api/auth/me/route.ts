import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, getSessionByRawToken } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const session = await getSessionByRawToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ authenticated: false, user: null });
  }
  return NextResponse.json({
    authenticated: true,
    csrfToken: session.csrfToken,
    user: {
      id: session.memberId,
      name: session.name,
      mobile: session.mobile,
      role: session.role,
      mustChangePin: session.mustChangePin,
      totpVerified: session.totpVerified,
    },
  });
}

