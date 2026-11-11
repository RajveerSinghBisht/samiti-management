import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import {
  handleApiError,
  istDateSchema,
  parseJsonBody,
  strictPositiveIntSchema,
  uuidSchema,
} from '@/lib/http';
import { listLoans, requestLoan } from '@/lib/services/loans';

const requestLoanSchema = z.object({
  cycleId: uuidSchema,
  memberId: uuidSchema,
  principalPaise: strictPositiveIntSchema,
  disbursedDate: istDateSchema,
  note: z.string().trim().max(300).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    const cycleId = req.nextUrl.searchParams.get('cycleId') || undefined;
    const rows = await listLoans(cycleId);
    return NextResponse.json({ loans: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, requestLoanSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const result = await requestLoan({
      ...parsed.data,
      adminId: auth.session.memberId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

