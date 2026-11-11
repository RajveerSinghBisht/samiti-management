import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import {
  handleApiError,
  parseJsonBody,
  strictPositiveIntSchema,
  uuidSchema,
} from '@/lib/http';
import { accrueLoanInterestForMonth } from '@/lib/services/loans';

const accrueSchema = z.object({
  year: strictPositiveIntSchema.min(2000).max(2100),
  month: strictPositiveIntSchema.min(1).max(12),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid loan ID' }, { status: 400 });
  }

  const parsed = await parseJsonBody(req, accrueSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const result = await accrueLoanInterestForMonth({
      loanId: id,
      year: parsed.data.year,
      month: parsed.data.month,
      adminId: auth.session.memberId,
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

