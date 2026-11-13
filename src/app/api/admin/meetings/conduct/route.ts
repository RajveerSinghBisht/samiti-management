import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import {
  handleApiError,
  istDateSchema,
  parseJsonBody,
  strictNonNegativeIntSchema,
  uuidSchema,
} from '@/lib/http';
import { conductMeeting } from '@/lib/services/meetings';

const conductMeetingSchema = z.object({
  cycleId: uuidSchema,
  meetingDate: istDateSchema,
  place: z.string().trim().min(2).max(300),
  hostMemberId: uuidSchema.optional().nullable(),
  notes: z.string().trim().max(1000).optional(),
  attendances: z
    .array(
      z.object({
        memberId: uuidSchema,
        isPresent: z.boolean(),
      })
    )
    .optional(),
  contributions: z
    .array(
      z.object({
        memberId: uuidSchema,
        paid: z.boolean(),
        amountPaise: strictNonNegativeIntSchema,
      })
    )
    .optional(),
  borrowerRepayments: z
    .array(
      z.object({
        loanId: uuidSchema,
        interestPaidPaise: strictNonNegativeIntSchema.optional(),
        principalPaidPaise: strictNonNegativeIntSchema.optional(),
      })
    )
    .optional(),
  bankInterestPaise: strictNonNegativeIntSchema.optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, conductMeetingSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const result = await conductMeeting({
      ...parsed.data,
      adminId: auth.session.memberId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

