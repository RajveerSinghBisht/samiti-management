import { asc } from 'drizzle-orm';
import { z } from 'zod';
import {
  approvals,
  closeDb,
  contributionSchedule,
  cycleMembers,
  cycles,
  getDb,
  ledgerEntries,
  loans,
  meetings,
  members,
  settings,
} from '@/db';
import { resetEnvCacheForTests } from '@/lib/env';
import { applyMigrations } from '@/db/migrate';

const exportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  members: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      mobile: z.string(),
      role: z.enum(['ADMIN', 'MEMBER']),
      status: z.enum(['ACTIVE', 'INACTIVE']),
      createdAt: z.string(),
    })
  ),
  cycles: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      startDate: z.string(),
      lengthMonths: z.number().int().positive(),
      monthlyContributionPaise: z.number().int().positive(),
      interestRateBps: z.number().int().min(0),
      interestMode: z.enum(['REDUCING_BALANCE', 'FLAT']),
      interestSharingMode: z.enum(['PROPORTIONAL_CONTRIBUTION', 'EQUAL']),
      rotationPayoutEnabled: z.boolean(),
      lateRuleMode: z.enum(['NONE', 'FIXED_PAISA', 'PERCENT_BPS']),
      lateRuleValue: z.number().int().min(0),
      status: z.enum(['ACTIVE', 'CLOSED']),
      closedAt: z.string().nullable(),
      createdByAdminId: z.string().uuid(),
      createdAt: z.string(),
    })
  ),
  cycleMembers: z.array(
    z.object({
      id: z.string().uuid(),
      cycleId: z.string().uuid(),
      memberId: z.string().uuid(),
      joinedMonthIndex: z.number().int().positive(),
      leftMonthIndex: z.number().int().positive().nullable(),
      rotationOrder: z.number().int().positive(),
      status: z.enum(['ACTIVE', 'LEFT']),
      createdAt: z.string(),
    })
  ),
  contributionSchedule: z.array(
    z.object({
      id: z.string().uuid(),
      cycleId: z.string().uuid(),
      memberId: z.string().uuid(),
      monthIndex: z.number().int().positive(),
      dueDate: z.string(),
      expectedAmountPaise: z.number().int().positive(),
      status: z.enum(['PENDING', 'PAID', 'SKIPPED']),
      createdAt: z.string(),
    })
  ),
  loans: z.array(
    z.object({
      id: z.string().uuid(),
      cycleId: z.string().uuid(),
      memberId: z.string().uuid(),
      principalPaise: z.number().int().positive(),
      interestRateBps: z.number().int().min(0),
      interestMode: z.enum(['REDUCING_BALANCE', 'FLAT']),
      disbursedDate: z.string(),
      status: z.enum(['PENDING_APPROVAL', 'ACTIVE', 'CLOSED', 'REJECTED']),
      note: z.string().nullable(),
      requestedByAdminId: z.string().uuid(),
      approvedByAdminId: z.string().uuid().nullable(),
      approvalId: z.string().uuid().nullable(),
      createdAt: z.string(),
    })
  ),
  ledgerEntries: z.array(
    z.object({
      id: z.string().uuid(),
      cycleId: z.string().uuid(),
      memberId: z.string().uuid().nullable(),
      loanId: z.string().uuid().nullable(),
      entryType: z.enum([
        'CONTRIBUTION',
        'LOAN_DISBURSEMENT',
        'REPAYMENT_PRINCIPAL',
        'REPAYMENT_INTEREST',
        'INTEREST_ACCRUAL',
        'ROTATION_PAYOUT',
        'SHARE_PAYOUT',
        'REVERSAL',
      ]),
      amountPaise: z.number().int().positive(),
      effectiveDate: z.string(),
      monthIndex: z.number().int().nullable(),
      reversesEntryId: z.string().uuid().nullable(),
      reason: z.string().nullable(),
      idempotencyKey: z.string().nullable(),
      createdByAdminId: z.string().uuid(),
      createdAt: z.string(),
    })
  ),
  approvals: z.array(
    z.object({
      id: z.string().uuid(),
      cycleId: z.string().uuid(),
      actionType: z.enum(['LOAN_APPROVAL', 'CYCLE_CLOSE', 'HIGH_VALUE_REVERSAL']),
      targetId: z.string().uuid(),
      amountPaise: z.number().int().min(0),
      payloadJson: z.record(z.string(), z.unknown()),
      reason: z.string().nullable(),
      status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
      requestedByAdminId: z.string().uuid(),
      decidedByAdminId: z.string().uuid().nullable(),
      decisionReason: z.string().nullable(),
      createdAt: z.string(),
      decidedAt: z.string().nullable(),
    })
  ),
  meetings: z.array(
    z.object({
      id: z.string().uuid(),
      cycleId: z.string().uuid(),
      meetingDate: z.string(),
      hostMemberId: z.string().uuid().nullable(),
      place: z.string(),
      notes: z.string().nullable(),
      createdByAdminId: z.string().uuid(),
      createdAt: z.string(),
    })
  ),
  settings: z.array(
    z.object({
      key: z.string(),
      valueJson: z.unknown(),
      updatedByAdminId: z.string().uuid().nullable(),
      updatedAt: z.string(),
    })
  ),
});

function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/**
 * Exports all non-secret samiti records in sanitized JSON or CSV format.
 * Credentials (PIN hashes, password hashes, TOTP secrets, recovery codes, session tokens)
 * are strictly excluded by explicit column selection.
 */
export async function exportAllData(format: 'json' | 'csv'): Promise<string> {
  const db = getDb();

  const safeMembers = await db
    .select({
      id: members.id,
      name: members.name,
      mobile: members.mobile,
      role: members.role,
      status: members.status,
      createdAt: members.createdAt,
    })
    .from(members)
    .orderBy(asc(members.createdAt));

  const cycleRows = await db.select().from(cycles).orderBy(asc(cycles.createdAt));
  const cmRows = await db.select().from(cycleMembers).orderBy(asc(cycleMembers.createdAt));
  const schedRows = await db
    .select()
    .from(contributionSchedule)
    .orderBy(asc(contributionSchedule.createdAt));
  const loanRows = await db.select().from(loans).orderBy(asc(loans.createdAt));
  const ledgerRows = await db
    .select()
    .from(ledgerEntries)
    .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id));
  const approvalRows = await db.select().from(approvals).orderBy(asc(approvals.createdAt));
  const meetingRows = await db.select().from(meetings).orderBy(asc(meetings.createdAt));
  const settingRows = await db.select().from(settings).orderBy(asc(settings.key));

  if (format === 'csv') {
    const header = [
      'id',
      'cycleId',
      'memberId',
      'loanId',
      'entryType',
      'amountPaise',
      'effectiveDate',
      'monthIndex',
      'reversesEntryId',
      'reason',
      'createdByAdminId',
      'createdAt',
    ].join(',');
    const lines = ledgerRows.map((row) =>
      [
        row.id,
        row.cycleId,
        row.memberId,
        row.loanId,
        row.entryType,
        row.amountPaise,
        row.effectiveDate,
        row.monthIndex,
        row.reversesEntryId,
        row.reason,
        row.createdByAdminId,
        row.createdAt.toISOString(),
      ]
        .map(escapeCsvCell)
        .join(',')
    );
    return [header, ...lines].join('\n');
  }

  const payload = {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    members: safeMembers.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
    cycles: cycleRows.map((c) => ({
      ...c,
      closedAt: c.closedAt ? c.closedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
    })),
    cycleMembers: cmRows.map((cm) => ({
      ...cm,
      createdAt: cm.createdAt.toISOString(),
    })),
    contributionSchedule: schedRows.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    })),
    loans: loanRows.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
    })),
    ledgerEntries: ledgerRows.map((e) => ({
      ...e,
      createdAt: e.createdAt.toISOString(),
    })),
    approvals: approvalRows.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
    })),
    meetings: meetingRows.map((mt) => ({
      ...mt,
      createdAt: mt.createdAt.toISOString(),
    })),
    settings: settingRows.map((st) => ({
      ...st,
      updatedAt: st.updatedAt.toISOString(),
    })),
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Restores a sanitized JSON backup into a migrated database (preserving IDs and append-only
 * ledger ordering so replaying balances produces bit-for-bit identical figures).
 * Restored users have credentials nulled and require admin reset / re-enrollment.
 */
export async function restoreFromExportJson(
  jsonString: string,
  databaseUrl?: string
): Promise<void> {
  const parsed = exportSchema.parse(JSON.parse(jsonString));

  if (databaseUrl && databaseUrl !== process.env.DATABASE_URL) {
    await closeDb();
    process.env.DATABASE_URL = databaseUrl;
    resetEnvCacheForTests();
  }

  await applyMigrations(databaseUrl);
  const db = getDb();

  await db.transaction(async (tx) => {
    for (const m of parsed.members) {
      await tx
        .insert(members)
        .values({
          id: m.id,
          name: m.name,
          mobile: m.mobile,
          role: m.role,
          status: m.status,
          pinHash: null,
          passwordHash: null,
          mustChangePin: m.role === 'MEMBER',
          totpEnabled: false,
          createdAt: new Date(m.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const c of parsed.cycles) {
      await tx
        .insert(cycles)
        .values({
          id: c.id,
          name: c.name,
          startDate: c.startDate,
          lengthMonths: c.lengthMonths,
          monthlyContributionPaise: c.monthlyContributionPaise,
          interestRateBps: c.interestRateBps,
          interestMode: c.interestMode,
          interestSharingMode: c.interestSharingMode,
          rotationPayoutEnabled: c.rotationPayoutEnabled,
          lateRuleMode: c.lateRuleMode,
          lateRuleValue: c.lateRuleValue,
          status: c.status,
          closedAt: c.closedAt ? new Date(c.closedAt) : null,
          createdByAdminId: c.createdByAdminId,
          createdAt: new Date(c.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const cm of parsed.cycleMembers) {
      await tx
        .insert(cycleMembers)
        .values({
          id: cm.id,
          cycleId: cm.cycleId,
          memberId: cm.memberId,
          joinedMonthIndex: cm.joinedMonthIndex,
          leftMonthIndex: cm.leftMonthIndex,
          rotationOrder: cm.rotationOrder,
          status: cm.status,
          createdAt: new Date(cm.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const s of parsed.contributionSchedule) {
      await tx
        .insert(contributionSchedule)
        .values({
          id: s.id,
          cycleId: s.cycleId,
          memberId: s.memberId,
          monthIndex: s.monthIndex,
          dueDate: s.dueDate,
          expectedAmountPaise: s.expectedAmountPaise,
          status: s.status,
          createdAt: new Date(s.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const l of parsed.loans) {
      await tx
        .insert(loans)
        .values({
          id: l.id,
          cycleId: l.cycleId,
          memberId: l.memberId,
          principalPaise: l.principalPaise,
          interestRateBps: l.interestRateBps,
          interestMode: l.interestMode,
          disbursedDate: l.disbursedDate,
          status: l.status,
          note: l.note,
          requestedByAdminId: l.requestedByAdminId,
          approvedByAdminId: l.approvedByAdminId,
          approvalId: l.approvalId,
          createdAt: new Date(l.createdAt),
        })
        .onConflictDoNothing();
    }

    // Insert non-reversal entries before reversals so trigger validate_reversal_target finds targets
    const nonReversals = parsed.ledgerEntries.filter((e) => e.entryType !== 'REVERSAL');
    const reversals = parsed.ledgerEntries.filter((e) => e.entryType === 'REVERSAL');

    for (const e of [...nonReversals, ...reversals]) {
      await tx
        .insert(ledgerEntries)
        .values({
          id: e.id,
          cycleId: e.cycleId,
          memberId: e.memberId,
          loanId: e.loanId,
          entryType: e.entryType,
          amountPaise: e.amountPaise,
          effectiveDate: e.effectiveDate,
          monthIndex: e.monthIndex,
          reversesEntryId: e.reversesEntryId,
          reason: e.reason,
          idempotencyKey: e.idempotencyKey,
          createdByAdminId: e.createdByAdminId,
          createdAt: new Date(e.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const a of parsed.approvals) {
      await tx
        .insert(approvals)
        .values({
          id: a.id,
          cycleId: a.cycleId,
          actionType: a.actionType,
          targetId: a.targetId,
          amountPaise: a.amountPaise,
          payloadJson: a.payloadJson,
          reason: a.reason,
          status: a.status,
          requestedByAdminId: a.requestedByAdminId,
          decidedByAdminId: a.decidedByAdminId,
          decisionReason: a.decisionReason,
          createdAt: new Date(a.createdAt),
          decidedAt: a.decidedAt ? new Date(a.decidedAt) : null,
        })
        .onConflictDoNothing();
    }

    for (const mt of parsed.meetings) {
      await tx
        .insert(meetings)
        .values({
          id: mt.id,
          cycleId: mt.cycleId,
          meetingDate: mt.meetingDate,
          hostMemberId: mt.hostMemberId,
          place: mt.place,
          notes: mt.notes,
          createdByAdminId: mt.createdByAdminId,
          createdAt: new Date(mt.createdAt),
        })
        .onConflictDoNothing();
    }

    for (const st of parsed.settings) {
      await tx
        .insert(settings)
        .values({
          key: st.key,
          valueJson: st.valueJson,
          updatedByAdminId: st.updatedByAdminId,
          updatedAt: new Date(st.updatedAt),
        })
        .onConflictDoNothing();
    }
  });
}

