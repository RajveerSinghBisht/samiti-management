import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import {
  handleApiError,
  istDateSchema,
  parseJsonBody,
  strictNonNegativeIntSchema,
  strictPositiveIntSchema,
} from '@/lib/http';
import { createCycle, listCycles } from '@/lib/services/cycles';

const createCycleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  startDate: istDateSchema,
  lengthMonths: strictPositiveIntSchema.max(120),
  monthlyContributionPaise: strictPositiveIntSchema,
  interestRateBps: strictNonNegativeIntSchema.max(5000),
  interestMode: z.enum(['REDUCING_BALANCE', 'FLAT']),
  interestSharingMode: z.enum(['PROPORTIONAL_CONTRIBUTION', 'EQUAL']),
  rotationPayoutEnabled: z.boolean().default(false),
  lateRuleMode: z.enum(['NONE', 'FIXED_PAISA', 'PERCENT_BPS']).optional(),
  lateRuleValue: strictNonNegativeIntSchema.optional(),
  normalLoanCapPaise: strictPositiveIntSchema.optional(),
  emergencyLoanCapPaise: strictPositiveIntSchema.optional(),
  meetingDayOfMonth: z.number().int().min(1).max(31).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    const rows = await listCycles();
    return NextResponse.json({ cycles: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, createCycleSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const cycle = await createCycle({
      ...parsed.data,
      adminId: auth.session.memberId,
    });
    return NextResponse.json({ cycle }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

