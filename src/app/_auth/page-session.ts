import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ActiveSession } from '@/lib/auth/guards';
import { SESSION_COOKIE_NAME, getSessionByRawToken } from '@/lib/auth/session';

export async function getServerSessionFromCookies(): Promise<ActiveSession | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return getSessionByRawToken(rawToken);
}

export async function requireMemberPageSession(): Promise<ActiveSession> {
  const session = await getServerSessionFromCookies();
  if (!session) {
    redirect('/login');
  }
  if (session.mustChangePin) {
    redirect('/login?changePin=1');
  }
  if (session.role === 'ADMIN') {
    redirect('/admin');
  }
  return session;
}

export async function requireAdminPageSession(): Promise<ActiveSession> {
  const session = await getServerSessionFromCookies();
  if (!session) {
    redirect('/admin/login');
  }
  if (session.role !== 'ADMIN') {
    redirect('/home');
  }
  if (!session.totpVerified) {
    redirect('/admin/setup-totp');
  }
  return session;
}
