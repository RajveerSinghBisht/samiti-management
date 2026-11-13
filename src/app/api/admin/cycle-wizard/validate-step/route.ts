import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { handleApiError, parseJsonBody } from '@/lib/http';
import { parseIstDateParts } from '@/lib/dates';

const validateStepSchema = z.object({
  step: z.number().int().min(1).max(5),
  stepData: z.record(z.string(), z.unknown()),
  priorData: z.record(z.string(), z.unknown()).optional(),
});

function calculateDuration(startDateStr: string, endDateStr: string): { months: number; years: number } {
  const start = parseIstDateParts(startDateStr);
  const end = parseIstDateParts(endDateStr);
  const totalMonths = (end.year - start.year) * 12 + (end.month - start.month);
  const months = Math.max(1, totalMonths);
  const years = Math.round((months / 12) * 10) / 10;
  return { months, years };
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, validateStepSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  const { step, stepData } = parsed.data;

  // Step-skipping prevention: if trying to validate later steps without required stepData
  if (step > 1 && (!stepData || Object.keys(stepData).length === 0)) {
    return NextResponse.json(
      { error: `Cannot skip to step ${step} without completing previous steps` },
      { status: 400 }
    );
  }

  try {
    if (step === 1) {
      const s1Schema = z.object({
        name: z.string().trim().min(3).max(100),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        meetingDayOfMonth: z.number().int().min(1).max(28).default(10),
      });
      const s1 = s1Schema.safeParse(stepData);
      if (!s1.success) {
        return NextResponse.json({ error: s1.error.issues[0]?.message || 'Invalid step 1' }, { status: 400 });
      }
      if (s1.data.endDate <= s1.data.startDate) {
        return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 });
      }
      const duration = calculateDuration(s1.data.startDate, s1.data.endDate);
      return NextResponse.json({ ok: true, computedDuration: duration });
    }

    if (step === 2) {
      const s2Schema = z.object({
        members: z.array(
          z.object({
            name: z.string().trim().min(2),
            mobile: z.string().trim().regex(/^\d{10}$/),
            isReturning: z.boolean().default(false),
          })
        ).min(2, 'At least 2 members are required'),
      });
      const s2 = s2Schema.safeParse(stepData);
      if (!s2.success) {
        return NextResponse.json({ error: s2.error.issues[0]?.message || 'Invalid step 2' }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (step === 3) {
      const s3Schema = z.object({
        monthlyContributionPaise: z.number().int().positive(),
        interestRateBps: z.number().int().min(0).max(5000),
        normalLoanCapPaise: z.number().int().positive(),
        emergencyLoanCapPaise: z.number().int().positive(),
      });
      const s3 = s3Schema.safeParse(stepData);
      if (!s3.success) {
        return NextResponse.json({ error: s3.error.issues[0]?.message || 'Invalid step 3' }, { status: 400 });
      }
      if (s3.data.emergencyLoanCapPaise < s3.data.normalLoanCapPaise) {
        return NextResponse.json({ error: 'Emergency loan cap cannot be less than normal loan cap' }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

