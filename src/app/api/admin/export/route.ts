import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError } from '@/lib/http';
import { exportAllData } from '@/lib/services/export-restore';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const formatParam = req.nextUrl.searchParams.get('format');
  const format = formatParam === 'csv' ? 'csv' : 'json';

  try {
    const body = await exportAllData(format);
    if (format === 'csv') {
      return new NextResponse(body, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="samiti-ledger-export.csv"',
        },
      });
    }
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="samiti-backup-export.json"',
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

