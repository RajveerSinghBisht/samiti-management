import { asc, eq } from 'drizzle-orm';
import { cycles, getDb, meetings, members } from '@/db';
import { parseIstDateParts } from '@/lib/dates';
import { recordAuditEvent } from './audit';
import { ServiceError } from './errors';

export async function listMeetings(cycleId?: string) {
  const db = getDb();
  const rows = cycleId
    ? await db
        .select()
        .from(meetings)
        .where(eq(meetings.cycleId, cycleId))
        .orderBy(asc(meetings.meetingDate))
    : await db.select().from(meetings).orderBy(asc(meetings.meetingDate));

  const memberRows = await db
    .select({ id: members.id, name: members.name })
    .from(members);
  const memberMap = new Map(memberRows.map((m) => [m.id, m.name]));

  return rows.map((m) => ({
    ...m,
    hostName: m.hostMemberId ? (memberMap.get(m.hostMemberId) ?? null) : null,
  }));
}

export async function createMeeting(input: {
  cycleId: string;
  meetingDate: string;
  hostMemberId?: string | null;
  place: string;
  notes?: string;
  adminId: string;
}) {
  parseIstDateParts(input.meetingDate);
  const place = input.place.trim();
  if (place.length < 2 || place.length > 300) {
    throw new ServiceError(400, 'Meeting place must be 2 to 300 characters');
  }

  const db = getDb();
  const cycleRows = await db.select().from(cycles).where(eq(cycles.id, input.cycleId)).limit(1);
  if (cycleRows.length === 0) {
    throw new ServiceError(404, 'Cycle not found');
  }

  const inserted = await db
    .insert(meetings)
    .values({
      cycleId: input.cycleId,
      meetingDate: input.meetingDate,
      hostMemberId: input.hostMemberId || null,
      place,
      notes: input.notes?.trim() || null,
      createdByAdminId: input.adminId,
    })
    .returning();

  const meeting = inserted.at(0);
  if (!meeting) throw new ServiceError(500, 'Failed to create meeting');

  await recordAuditEvent({
    actorMemberId: input.adminId,
    actorRole: 'ADMIN',
    action: 'CREATE_MEETING',
    targetType: 'meeting',
    targetId: meeting.id,
    metadata: { meetingDate: meeting.meetingDate, place: meeting.place },
  });

  return meeting;
}

export async function conductMeeting(input: {
  cycleId: string;
  meetingDate: string;
  place: string;
  hostMemberId?: string | null;
  notes?: string;
  attendances?: Array<{ memberId: string; isPresent: boolean }>;
  contributions?: Array<{ memberId: string; paid: boolean; amountPaise: number }>;
  borrowerRepayments?: Array<{
    loanId: string;
    interestPaidPaise?: number;
    principalPaidPaise?: number;
  }>;
  bankInterestPaise?: number;
  adminId: string;
}) {
  parseIstDateParts(input.meetingDate);
  const place = input.place.trim();
  if (place.length < 2 || place.length > 300) {
    throw new ServiceError(400, 'Meeting place must be 2 to 300 characters');
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    const cycleRows = await tx
      .select()
      .from(cycles)
      .where(eq(cycles.id, input.cycleId))
      .limit(1);
    if (cycleRows.length === 0) {
      throw new ServiceError(404, 'Cycle not found');
    }

    const inserted = await tx
      .insert(meetings)
      .values({
        cycleId: input.cycleId,
        meetingDate: input.meetingDate,
        hostMemberId: input.hostMemberId || null,
        place,
        notes: input.notes?.trim() || null,
        status: 'SCHEDULED',
        createdByAdminId: input.adminId,
      })
      .returning();

    const meeting = inserted.at(0);
    if (!meeting) throw new ServiceError(500, 'Failed to create meeting');

    // Process contributions
    const { appendLedgerEntry } = await import('./ledger');
    for (const c of input.contributions || []) {
      if (c.paid && c.amountPaise > 0) {
        await appendLedgerEntry(
          {
            cycleId: input.cycleId,
            memberId: c.memberId,
            loanId: null,
            entryType: 'CONTRIBUTION',
            amountPaise: c.amountPaise,
            effectiveDate: input.meetingDate,
            reason: `Monthly contribution for meeting ${input.meetingDate}`,
            idempotencyKey: `contrib:${input.cycleId}:${c.memberId}:${input.meetingDate}`,
            createdByAdminId: input.adminId,
          },
          tx
        );
      }
    }

    // Process bank interest
    if (input.bankInterestPaise && input.bankInterestPaise > 0) {
      await appendLedgerEntry(
        {
          cycleId: input.cycleId,
          memberId: null,
          loanId: null,
          entryType: 'BANK_INTEREST',
          amountPaise: input.bankInterestPaise,
          effectiveDate: input.meetingDate,
          reason: `Bank interest received on ${input.meetingDate}`,
          idempotencyKey: `bank-interest:${input.cycleId}:${input.meetingDate}`,
          createdByAdminId: input.adminId,
        },
        tx
      );
    }

    await recordAuditEvent(
      {
        actorMemberId: input.adminId,
        actorRole: 'ADMIN',
        action: 'CONDUCT_MEETING',
        targetType: 'meeting',
        targetId: meeting.id,
        metadata: {
          meetingDate: meeting.meetingDate,
          attendeesCount: input.attendances?.filter((a) => a.isPresent).length ?? 0,
        },
      },
      tx
    );

    return { meeting };
  });
}

export async function closeMeeting(input: {
  meetingId: string;
  summaryNote?: string;
  adminId: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(meetings)
      .set({
        status: 'CLOSED',
        summaryNote: input.summaryNote?.trim() || null,
        closedAt: new Date(),
      })
      .where(eq(meetings.id, input.meetingId))
      .returning();

    const meeting = updated.at(0);
    if (!meeting) throw new ServiceError(404, 'Meeting not found');

    await recordAuditEvent(
      {
        actorMemberId: input.adminId,
        actorRole: 'ADMIN',
        action: 'CLOSE_MEETING',
        targetType: 'meeting',
        targetId: meeting.id,
        metadata: { summaryNote: meeting.summaryNote },
      },
      tx
    );

    return { meeting };
  });
}

