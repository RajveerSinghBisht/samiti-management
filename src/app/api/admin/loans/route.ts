import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import {
  handleApiError,
  istDateSchema,
  parseJsonBody,
  strictNonNegativeIntSchema,
  strictPositiveIntSchema,
  uuidSchema,
} from '@/lib/http';
import { listLoans, requestLoan } from '@/lib/services/loans';

const requestLoanSchema = z.object({
  cycleId: uuidSchema,
  memberId: uuidSchema,
  principalPaise: strictPositiveIntSchema,
  interestRateBps: strictNonNegativeIntSchema.max(5000).optional(),
  repaymentMode: z.enum(['MONTHLY_INSTALLMENTS', 'FULL_REPAYMENT']).optional(),
  termMonths: strictPositiveIntSchema.max(120).optional(),
  dueDate: istDateSchema.optional(),
  disbursedDate: istDateSchema,
  isEmergency: z.boolean().optional(),
  emergencyReason: z.string().trim().max(500).optional(),
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

