import { asc, eq } from 'drizzle-orm';
import {
  contributionSchedule,
  cycleMembers,
  cycles,
  getDb,
  members,
} from '@/db';
import { getEnv } from '@/lib/env';
import {
  hashPassword,
  hashPin,
  validateAdminPasswordFormat,
  validatePinFormat,
} from '@/lib/auth/crypto';
import { deleteAllMemberSessions } from '@/lib/auth/session';
import { addMonthsIst } from '@/lib/dates';
import { recordAuditEvent } from './audit';
import { ServiceError } from './errors';

export interface SafeMemberView {
  id: string;
  name: string;
  mobile: string;
  role: 'ADMIN' | 'MEMBER';
  status: 'ACTIVE' | 'INACTIVE';
  mustChangePin: boolean;
  totpEnabled: boolean;
  createdAt: Date;
}

export async function listMembers(): Promise<SafeMemberView[]> {
  const db = getDb();
  return db
    .select({
      id: members.id,
      name: members.name,
      mobile: members.mobile,
      role: members.role,
      status: members.status,
      mustChangePin: members.mustChangePin,
      totpEnabled: members.totpEnabled,
      createdAt: members.createdAt,
    })
    .from(members)
    .orderBy(asc(members.createdAt), asc(members.name));
}

export async function createMember(input: {
  name: string;
  mobile: string;
  role?: 'ADMIN' | 'MEMBER';
  initialSecret?: string;
  cycleId?: string;
  adminId: string;
}): Promise<SafeMemberView & { member: SafeMemberView; temporaryPin?: string }> {
  const name = input.name.trim();
  const mobile = input.mobile.trim();
  const role = input.role || 'MEMBER';

  if (name.length < 2 || name.length > 100) {
    throw new ServiceError(400, 'Name must be 2 to 100 characters');
  }
  if (!/^\d{10}$/.test(mobile)) {
    throw new ServiceError(400, 'Mobile number must be exactly 10 digits');
  }

  const env = getEnv();
  let pinHash: string | null = null;
  let passwordHash: string | null = null;
  let temporaryPin: string | undefined = undefined;
  let mustChangePin = false;

  let secret = input.initialSecret?.trim();

  if (role === 'MEMBER') {
    if (input.cycleId) {
      if (secret) {
        if (!/^\d{6}$/.test(secret)) {
          throw new ServiceError(400, 'Member PIN must be strictly 6 digits');
        }
      } else {
        secret = String(Math.floor(100000 + Math.random() * 900000));
      }
      temporaryPin = secret;
      mustChangePin = true;
    } else {
      if (!secret) {
        secret = String(Math.floor(100000 + Math.random() * 900000));
        temporaryPin = secret;
        mustChangePin = true;
      } else if (!validatePinFormat(secret)) {
        throw new ServiceError(400, 'Member PIN must be 4 to 6 digits');
      }
    }
    pinHash = await hashPin(secret, env.PIN_PEPPER);
  } else {
    if (!secret || !validateAdminPasswordFormat(secret)) {
      throw new ServiceError(400, 'Admin password must be at least 12 characters');
    }
    passwordHash = await hashPassword(secret, env.PIN_PEPPER);
  }

  const db = getDb();
  const existing = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.mobile, mobile))
    .limit(1);
  if (existing.length > 0) {
    throw new ServiceError(409, 'Mobile number is already registered');
  }

  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(members)
      .values({
        name,
        mobile,
        role,
        status: 'ACTIVE',
        pinHash,
        passwordHash,
        mustChangePin,
        totpEnabled: false,
      })
      .returning({
        id: members.id,
        name: members.name,
        mobile: members.mobile,
        role: members.role,
        status: members.status,
        mustChangePin: members.mustChangePin,
        totpEnabled: members.totpEnabled,
        createdAt: members.createdAt,
      });

    const member = inserted.at(0);
    if (!member) {
      throw new ServiceError(500, 'Failed to create member');
    }

    if (member.role === 'MEMBER') {
      const activeCycles = input.cycleId
        ? await tx.select().from(cycles).where(eq(cycles.id, input.cycleId))
        : await tx.select().from(cycles).where(eq(cycles.status, 'ACTIVE'));

      for (const cycle of activeCycles) {
        const existingCount = (
          await tx
            .select({ id: cycleMembers.id })
            .from(cycleMembers)
            .where(eq(cycleMembers.cycleId, cycle.id))
        ).length;

        await tx
          .insert(cycleMembers)
          .values({
            cycleId: cycle.id,
            memberId: member.id,
            joinedMonthIndex: 1,
            rotationOrder: existingCount + 1,
            status: 'ACTIVE',
          })
          .onConflictDoNothing();

        const scheduleRows = [];
        for (let m = 1; m <= cycle.lengthMonths; m++) {
          scheduleRows.push({
            cycleId: cycle.id,
            memberId: member.id,
            monthIndex: m,
            dueDate: addMonthsIst(cycle.startDate, m - 1),
            expectedAmountPaise: cycle.monthlyContributionPaise,
            status: 'PENDING' as const,
          });
        }
        if (scheduleRows.length > 0) {
          await tx.insert(contributionSchedule).values(scheduleRows).onConflictDoNothing();
        }
      }
    }

    await recordAuditEvent(
      {
        actorMemberId: input.adminId,
        actorRole: 'ADMIN',
        action: 'CREATE_MEMBER',
        targetType: 'member',
        targetId: member.id,
        metadata: { role: member.role, mobile: member.mobile },
      },
      tx
    );

    return member;
  });

  return {
    ...created,
    member: { ...created },
    temporaryPin,
  };
}

export async function updateMember(input: {
  id: string;
  name?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  adminId: string;
}): Promise<SafeMemberView> {
  const db = getDb();
  const rows = await db.select().from(members).where(eq(members.id, input.id)).limit(1);
  const existing = rows.at(0);
  if (!existing) {
    throw new ServiceError(404, 'Member not found');
  }

  const nextName = input.name !== undefined ? input.name.trim() : existing.name;
  if (nextName.length < 2 || nextName.length > 100) {
    throw new ServiceError(400, 'Name must be 2 to 100 characters');
  }
  const nextStatus = input.status ?? existing.status;

  const updated = await db
    .update(members)
    .set({
      name: nextName,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(members.id, input.id))
    .returning({
      id: members.id,
      name: members.name,
      mobile: members.mobile,
      role: members.role,
      status: members.status,
      mustChangePin: members.mustChangePin,
      totpEnabled: members.totpEnabled,
      createdAt: members.createdAt,
    });

  if (nextStatus === 'INACTIVE') {
    await deleteAllMemberSessions(input.id);
  }

  await recordAuditEvent({
    actorMemberId: input.adminId,
    actorRole: 'ADMIN',
    action: 'UPDATE_MEMBER',
    targetType: 'member',
    targetId: input.id,
    metadata: { status: nextStatus },
  });

  const row = updated.at(0);
  if (!row) throw new ServiceError(500, 'Failed to update member');
  return row;
}

export async function resetMemberPin(input: {
  id: string;
  newPin?: string;
  adminId: string;
}): Promise<{ temporaryPin: string }> {
  const env = getEnv();
  const db = getDb();

  const rows = await db.select().from(members).where(eq(members.id, input.id)).limit(1);
  const member = rows.at(0);
  if (!member) {
    throw new ServiceError(404, 'Member not found');
  }
  if (member.role !== 'MEMBER') {
    throw new ServiceError(400, 'PIN reset applies to MEMBER accounts only');
  }

  const generatedPin =
    input.newPin && input.newPin.trim().length > 0
      ? input.newPin.trim()
      : String(Math.floor(100000 + Math.random() * 900000));

  if (!validatePinFormat(generatedPin)) {
    throw new ServiceError(400, 'PIN must be 4 to 6 digits');
  }

  const pinHash = await hashPin(generatedPin, env.PIN_PEPPER);

  await db
    .update(members)
    .set({
      pinHash,
      mustChangePin: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(members.id, input.id));

  await deleteAllMemberSessions(input.id);

  await recordAuditEvent({
    actorMemberId: input.adminId,
    actorRole: 'ADMIN',
    action: 'RESET_MEMBER_PIN',
    targetType: 'member',
    targetId: input.id,
    metadata: { mustChangePin: true },
  });

  return { temporaryPin: generatedPin };
}

