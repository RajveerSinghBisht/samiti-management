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
import { repayLoan } from '@/lib/services/loans';

const repaySchema = z.object({
  amountPaise: strictPositiveIntSchema,
  effectiveDate: istDateSchema,
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

  const parsed = await parseJsonBody(req, repaySchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const result = await repayLoan({
      loanId: id,
      amountPaise: parsed.data.amountPaise,
      effectiveDate: parsed.data.effectiveDate,
      adminId: auth.session.memberId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

