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

