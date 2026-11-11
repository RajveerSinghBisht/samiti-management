import { and, eq, gt } from 'drizzle-orm';
import type { NextRequest, NextResponse } from 'next/server';
import { getDb, members, sessions } from '@/db';
import { getEnv } from '@/lib/env';
import { generateRandomToken, sha256Hex } from './crypto';

export const SESSION_COOKIE_NAME = 'samiti_session';
export const PRE_CSRF_COOKIE_NAME = 'samiti_pre_csrf';

export interface ActiveSession {
  sessionId: string;
  memberId: string;
  name: string;
  mobile: string;
  role: 'ADMIN' | 'MEMBER';
  totpVerified: boolean;
  mustChangePin: boolean;
  csrfToken: string;
  expiresAt: Date;
}

function getTtlMs(role: 'ADMIN' | 'MEMBER'): number {
  const env = getEnv();
  const days = role === 'ADMIN' ? env.ADMIN_SESSION_DAYS : env.MEMBER_SESSION_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

export function isSecureCookieContext(req?: NextRequest): boolean {
  const env = getEnv();
  if (env.APP_URL.startsWith('https://')) return true;
  if (!req) return false;
  if (req.headers.get('x-forwarded-proto') === 'https') return true;
  return req.url.startsWith('https://');
}

export async function createSession(input: {
  memberId: string;
  role: 'ADMIN' | 'MEMBER';
  totpVerified: boolean;
  mustChangePin: boolean;
  previousSessionToken?: string | null;
}): Promise<{
  rawToken: string;
  csrfToken: string;
  expiresAt: Date;
  maxAgeSeconds: number;
}> {
  const db = getDb();

  if (input.previousSessionToken) {
    const prevHash = sha256Hex(input.previousSessionToken);
    await db.delete(sessions).where(eq(sessions.tokenHash, prevHash));
  }

  const rawToken = generateRandomToken(32);
  const tokenHash = sha256Hex(rawToken);
  const csrfToken = generateRandomToken(32);
  const ttlMs = getTtlMs(input.role);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  await db.insert(sessions).values({
    tokenHash,
    memberId: input.memberId,
    role: input.role,
    totpVerified: input.totpVerified,
    mustChangePin: input.mustChangePin,
    csrfToken,
    expiresAt,
    lastActiveAt: now,
  });

  return {
    rawToken,
    csrfToken,
    expiresAt,
    maxAgeSeconds: Math.floor(ttlMs / 1000),
  };
}

export async function getSessionByRawToken(rawToken: string | undefined | null): Promise<ActiveSession | null> {
  if (!rawToken || rawToken.length < 16) return null;
  const db = getDb();
  const tokenHash = sha256Hex(rawToken);
  const now = new Date();

  const rows = await db
    .select({
      sessionId: sessions.id,
      memberId: sessions.memberId,
      name: members.name,
      mobile: members.mobile,
      role: sessions.role,
      memberRole: members.role,
      memberStatus: members.status,
      totpVerified: sessions.totpVerified,
      mustChangePin: sessions.mustChangePin,
      csrfToken: sessions.csrfToken,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(members, eq(sessions.memberId, members.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);

  const row = rows.at(0);
  if (!row || row.memberStatus !== 'ACTIVE' || row.role !== row.memberRole) {
    return null;
  }

  // Sliding renewal when less than 50% of session TTL remains
  const ttlMs = getTtlMs(row.role);
  const remainingMs = row.expiresAt.getTime() - now.getTime();
  let currentExpiresAt = row.expiresAt;
  if (remainingMs < ttlMs / 2) {
    currentExpiresAt = new Date(now.getTime() + ttlMs);
    await db
      .update(sessions)
      .set({ expiresAt: currentExpiresAt, lastActiveAt: now })
      .where(eq(sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    memberId: row.memberId,
    name: row.name,
    mobile: row.mobile,
    role: row.role,
    totpVerified: row.totpVerified,
    mustChangePin: row.mustChangePin,
    csrfToken: row.csrfToken,
    expiresAt: currentExpiresAt,
  };
}

export async function deleteSessionByRawToken(rawToken: string | undefined | null): Promise<void> {
  if (!rawToken) return;
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(rawToken)));
}

export async function deleteAllMemberSessions(memberId: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.memberId, memberId));
}

export function attachSessionCookie(
  res: NextResponse,
  rawToken: string,
  maxAgeSeconds: number,
  secure: boolean
): void {
  res.cookies.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(res: NextResponse, secure: boolean): void {
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
  });
}

