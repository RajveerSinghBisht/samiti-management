import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { approvals, cycles, cycleMembers, contributionSchedule, getDb, members } from '@/db';
import { hashPin } from '@/lib/auth/crypto';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { getEnv } from '@/lib/env';
import { handleApiError, parseJsonBody } from '@/lib/http';
import { parseIstDateParts, addMonthsIst } from '@/lib/dates';
import { recordAuditEvent } from '@/lib/services/audit';

const createWizardCycleSchema = z.object({
  name: z.string().trim().min(3).max(100),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meetingDayOfMonth: z.number().int().min(1).max(28).default(10),
  monthlyContributionPaise: z.number().int().positive(),
  interestRateBps: z.number().int().min(0).max(5000).default(100),
  normalLoanCapPaise: z.number().int().positive().default(5000000),
  emergencyLoanCapPaise: z.number().int().positive().default(10000000),
  interestSharingMode: z.enum(['PROPORTIONAL_CONTRIBUTION', 'EQUAL']).default('EQUAL'),
  rotationPayoutEnabled: z.boolean().default(false),
  adminIds: z.array(z.string().uuid()).min(2, 'At least two admins are required'),
  members: z.array(
    z.object({
      name: z.string().trim().min(2),
      mobile: z.string().trim().regex(/^\d{10}$/),
      isReturning: z.boolean().default(false),
    })
  ).min(2),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, createWizardCycleSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  const data = parsed.data;
  const start = parseIstDateParts(data.startDate);
  const end = parseIstDateParts(data.endDate);
  const lengthMonths = Math.max(1, (end.year - start.year) * 12 + (end.month - start.month));

  const rupeesPerMonth = Math.round(data.monthlyContributionPaise / 100).toLocaleString('en-IN');
  const ratePercent = (data.interestRateBps / 100).toFixed(0);
  const reviewSummary = `${data.members.length} members, Rs ${rupeesPerMonth} each month, ends ${data.endDate}, interest ${ratePercent} percent a month on balance, normal cap Rs ${(data.normalLoanCapPaise / 100).toLocaleString('en-IN')}, emergency cap Rs ${(data.emergencyLoanCapPaise / 100).toLocaleString('en-IN')}.`;

  const db = getDb();
  try {
    const cycleRecord = await db.transaction(async (tx) => {
      const [insertedCycle] = await tx
        .insert(cycles)
        .values({
          name: data.name,
          startDate: data.startDate,
          endDate: data.endDate,
          lengthMonths,
          monthlyContributionPaise: data.monthlyContributionPaise,
          interestRateBps: data.interestRateBps,
          interestMode: 'REDUCING_BALANCE',
          interestSharingMode: data.interestSharingMode,
          normalLoanCapPaise: data.normalLoanCapPaise,
          emergencyLoanCapPaise: data.emergencyLoanCapPaise,
          meetingDayOfMonth: data.meetingDayOfMonth,
          rotationPayoutEnabled: data.rotationPayoutEnabled,
          lateRuleMode: 'NONE',
          lateRuleValue: 0,
          status: 'PENDING_SECOND_ADMIN_APPROVAL',
          reviewSummary,
          createdByAdminId: auth.session.memberId,
        })
        .returning();

      if (!insertedCycle) {
        throw new Error('Failed to create cycle record');
      }

      // Create or enroll members
      for (const [i, m] of data.members.entries()) {
        let memberId: string;
        const existingRows = await tx
          .select({ id: members.id })
          .from(members)
          .where(eq(members.mobile, m.mobile))
          .limit(1);

        if (existingRows.length > 0) {
          memberId = existingRows[0]!.id;
        } else {
          const tempPin = String(Math.floor(100000 + Math.random() * 900000));
          const pinHash = await hashPin(tempPin, getEnv().PIN_PEPPER);
          const [newMem] = await tx
            .insert(members)
            .values({
              name: m.name,
              mobile: m.mobile,
              role: 'MEMBER',
              status: 'ACTIVE',
              pinHash,
              mustChangePin: true,
            })
            .returning();
          memberId = newMem!.id;
        }

        await tx
          .insert(cycleMembers)
          .values({
            cycleId: insertedCycle.id,
            memberId,
            joinedMonthIndex: 1,
            rotationOrder: i + 1,
            status: 'ACTIVE',
          })
          .onConflictDoNothing();

        for (let month = 1; month <= lengthMonths; month++) {
          await tx
            .insert(contributionSchedule)
            .values({
              cycleId: insertedCycle.id,
              memberId,
              monthIndex: month,
              dueDate: addMonthsIst(data.startDate, month - 1),
              expectedAmountPaise: data.monthlyContributionPaise,
              status: 'PENDING',
            })
            .onConflictDoNothing();
        }
      }

      const [approval] = await tx
        .insert(approvals)
        .values({
          cycleId: insertedCycle.id,
          actionType: 'CYCLE_ACTIVATION',
          targetId: insertedCycle.id,
          amountPaise: 0,
          payloadJson: { cycleId: insertedCycle.id, name: insertedCycle.name },
          reason: 'New cycle activation confirmation',
          status: 'PENDING',
          requestedByAdminId: auth.session.memberId,
        })
        .returning();

      return { ...insertedCycle, approvalId: approval?.id };
    });

    await recordAuditEvent({
      actorMemberId: auth.session.memberId,
      actorRole: 'ADMIN',
      action: 'CYCLE_WIZARD_CREATE',
      targetType: 'cycle',
      targetId: cycleRecord.id,
      metadata: { reviewSummary },
    });

    return NextResponse.json(cycleRecord, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
