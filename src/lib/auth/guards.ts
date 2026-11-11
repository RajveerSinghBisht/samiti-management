import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqualStr } from './crypto';
import {
  PRE_CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  getSessionByRawToken,
  type ActiveSession,
} from './session';

export type { ActiveSession };

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function validateSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin) return true;
  if (!host) return false;
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host === host;
  } catch {
    return false;
  }
}

export function requirePreLoginCsrf(req: NextRequest): NextResponse | null {
  if (!validateSameOrigin(req)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const cookieVal = req.cookies.get(PRE_CSRF_COOKIE_NAME)?.value;
  const headerVal = req.headers.get('x-csrf-token');
  if (!cookieVal || !headerVal || !timingSafeEqualStr(cookieVal, headerVal)) {
    return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
  }
  return null;
}

export async function requireAuthenticatedSession(
  req: NextRequest,
  options: {
    requireAdmin?: boolean;
    allowUnverifiedTotp?: boolean;
    allowMustChangePin?: boolean;
    requireCsrf?: boolean;
  } = {}
): Promise<{ session: ActiveSession } | { errorResponse: NextResponse }> {
  const rawToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionByRawToken(rawToken);
  if (!session) {
    return { errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const shouldCheckCsrf = options.requireCsrf ?? MUTATING_METHODS.has(req.method.toUpperCase());
  if (shouldCheckCsrf) {
    if (!validateSameOrigin(req)) {
      return {
        errorResponse: NextResponse.json({ error: 'Invalid request origin' }, { status: 403 }),
      };
    }
    const headerCsrf = req.headers.get('x-csrf-token');
    if (!headerCsrf || !timingSafeEqualStr(headerCsrf, session.csrfToken)) {
      return {
        errorResponse: NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 }),
      };
    }
  }

  if (options.requireAdmin && session.role !== 'ADMIN') {
    return { errorResponse: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  if (session.role === 'ADMIN' && !session.totpVerified && !options.allowUnverifiedTotp) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Authenticator setup required' },
        { status: 403 }
      ),
    };
  }

  if (session.mustChangePin && !options.allowMustChangePin) {
    return {
      errorResponse: NextResponse.json(
        { error: 'PIN change required before continuing' },
        { status: 403 }
      ),
    };
  }

  return { session };
}
