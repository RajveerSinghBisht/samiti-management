import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqualStr } from '@/lib/auth/crypto';
import { getEnv } from '@/lib/env';
import { handleApiError } from '@/lib/http';
import { runWeeklyReminders } from '@/lib/services/messaging';

function isAuthorizedCron(req: NextRequest): boolean {
  const expected = getEnv().CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (timingSafeEqualStr(token, expected)) return true;
  }
  const secretHeader = req.headers.get('x-cron-secret');
  if (secretHeader && timingSafeEqualStr(secretHeader.trim(), expected)) {
    return true;
  }
  return false;
}

async function handleCron(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runWeeklyReminders();
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET(req: NextRequest) {
  return handleCron(req);
}

export async function POST(req: NextRequest) {
  return handleCron(req);
}

