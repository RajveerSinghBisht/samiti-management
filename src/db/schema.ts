import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const members = pgTable('members', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  mobile: text('mobile').notNull().unique(),
  role: text('role').$type<'ADMIN' | 'MEMBER'>().notNull(),
  status: text('status').$type<'ACTIVE' | 'INACTIVE'>().notNull().default('ACTIVE'),
  pinHash: text('pin_hash'),
  passwordHash: text('password_hash'),
  mustChangePin: boolean('must_change_pin').notNull().default(false),
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  totpSecretEncrypted: text('totp_secret_encrypted'),
  totpPendingSecretEncrypted: text('totp_pending_secret_encrypted'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  recoveryCodesHashes: jsonb('recovery_codes_hashes').$type<string[] | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const cycles = pgTable('cycles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  lengthMonths: integer('length_months').notNull(),
  monthlyContributionPaise: integer('monthly_contribution_paise').notNull(),
  interestRateBps: integer('interest_rate_bps').notNull(),
  interestMode: text('interest_mode').$type<'REDUCING_BALANCE' | 'FLAT'>().notNull(),
  interestSharingMode: text('interest_sharing_mode')
    .$type<'PROPORTIONAL_CONTRIBUTION' | 'EQUAL'>()
    .notNull(),
  normalLoanCapPaise: integer('normal_loan_cap_paise').notNull().default(5000000),
  emergencyLoanCapPaise: integer('emergency_loan_cap_paise').notNull().default(10000000),
  meetingDayOfMonth: integer('meeting_day_of_month').notNull().default(10),
  rotationPayoutEnabled: boolean('rotation_payout_enabled').notNull().default(false),
  lateRuleMode: text('late_rule_mode')
    .$type<'NONE' | 'FIXED_PAISA' | 'PERCENT_BPS'>()
    .notNull()
    .default('NONE'),
  lateRuleValue: integer('late_rule_value').notNull().default(0),
  reviewSummary: text('review_summary'),
  status: text('status')
    .$type<'ACTIVE' | 'CLOSED' | 'PENDING_SECOND_ADMIN_APPROVAL'>()
    .notNull()
    .default('ACTIVE'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdByAdminId: uuid('created_by_admin_id')
    .notNull()
    .references(() => members.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const cycleMembers = pgTable(
  'cycle_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => cycles.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    joinedMonthIndex: integer('joined_month_index').notNull().default(1),
    leftMonthIndex: integer('left_month_index'),
    rotationOrder: integer('rotation_order').notNull().default(1),
    status: text('status').$type<'ACTIVE' | 'LEFT'>().notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_cycle_members_cycle_member').on(table.cycleId, table.memberId)]
);

export const contributionSchedule = pgTable(
  'contribution_schedule',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => cycles.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    monthIndex: integer('month_index').notNull(),
    dueDate: text('due_date').notNull(),
    expectedAmountPaise: integer('expected_amount_paise').notNull(),
    status: text('status').$type<'PENDING' | 'PAID' | 'SKIPPED'>().notNull().default('PENDING'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_contrib_schedule_cycle_member_month').on(
      table.cycleId,
      table.memberId,
      table.monthIndex
    ),
  ]
);

export const loans = pgTable('loans', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id')
    .notNull()
    .references(() => cycles.id),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id),
  principalPaise: integer('principal_paise').notNull(),
  interestRateBps: integer('interest_rate_bps').notNull(),
  interestMode: text('interest_mode').$type<'REDUCING_BALANCE' | 'FLAT'>().notNull(),
  repaymentMode: text('repayment_mode')
    .$type<'MONTHLY_INSTALLMENTS' | 'FULL_REPAYMENT'>()
    .notNull()
    .default('MONTHLY_INSTALLMENTS'),
  termMonths: integer('term_months'),
  dueDate: text('due_date'),
  isEmergency: boolean('is_emergency').notNull().default(false),
  emergencyReason: text('emergency_reason'),
  disbursedDate: text('disbursed_date').notNull(),
  status: text('status')
    .$type<'PENDING_APPROVAL' | 'ACTIVE' | 'CLOSED' | 'REJECTED'>()
    .notNull()
    .default('PENDING_APPROVAL'),
  note: text('note'),
  requestedByAdminId: uuid('requested_by_admin_id')
    .notNull()
    .references(() => members.id),
  approvedByAdminId: uuid('approved_by_admin_id').references(() => members.id),
  approvalId: uuid('approval_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => cycles.id),
    memberId: uuid('member_id').references(() => members.id),
    loanId: uuid('loan_id').references(() => loans.id),
    entryType: text('entry_type')
      .$type<
        | 'CONTRIBUTION'
        | 'LOAN_DISBURSEMENT'
        | 'REPAYMENT_PRINCIPAL'
        | 'REPAYMENT_INTEREST'
        | 'INTEREST_ACCRUAL'
        | 'ROTATION_PAYOUT'
        | 'SHARE_PAYOUT'
        | 'REVERSAL'
        | 'GOOD_CAUSE_GRANT'
        | 'BANK_INTEREST'
      >()
      .notNull(),
    amountPaise: integer('amount_paise').notNull(),
    effectiveDate: text('effective_date').notNull(),
    monthIndex: integer('month_index'),
    reversesEntryId: uuid('reverses_entry_id'),
    reason: text('reason'),
    idempotencyKey: text('idempotency_key'),
    createdByAdminId: uuid('created_by_admin_id')
      .notNull()
      .references(() => members.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_ledger_reverses_entry_id').on(table.reversesEntryId),
    uniqueIndex('uq_ledger_idempotency_key').on(table.idempotencyKey),
    check('chk_ledger_amount_positive', sql`${table.amountPaise} > 0`),
  ]
);

export const approvals = pgTable('approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id')
    .notNull()
    .references(() => cycles.id),
  actionType: text('action_type')
    .$type<
      | 'LOAN_APPROVAL'
      | 'CYCLE_CLOSE'
      | 'HIGH_VALUE_REVERSAL'
      | 'CYCLE_ACTIVATION'
      | 'GOOD_CAUSE_GRANT'
      | 'EMERGENCY_LOAN'
    >()
    .notNull(),
  targetId: uuid('target_id').notNull(),
  amountPaise: integer('amount_paise').notNull().default(0),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
  reason: text('reason'),
  status: text('status').$type<'PENDING' | 'APPROVED' | 'REJECTED'>().notNull().default('PENDING'),
  requestedByAdminId: uuid('requested_by_admin_id')
    .notNull()
    .references(() => members.id),
  decidedByAdminId: uuid('decided_by_admin_id').references(() => members.id),
  decisionReason: text('decision_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

export const meetings = pgTable('meetings', {
  id: uuid('id').defaultRandom().primaryKey(),
  cycleId: uuid('cycle_id')
    .notNull()
    .references(() => cycles.id),
  meetingDate: text('meeting_date').notNull(),
  hostMemberId: uuid('host_member_id').references(() => members.id),
  place: text('place').notNull(),
  notes: text('notes'),
  status: text('status')
    .$type<'SCHEDULED' | 'CONDUCTED' | 'CLOSED'>()
    .notNull()
    .default('SCHEDULED'),
  summaryNote: text('summary_note'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdByAdminId: uuid('created_by_admin_id')
    .notNull()
    .references(() => members.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const messageLogs = pgTable(
  'message_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => cycles.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    loanId: uuid('loan_id')
      .notNull()
      .references(() => loans.id),
    weekKey: text('week_key').notNull(),
    channelMode: text('channel_mode').$type<'PREPARE' | 'SEND'>().notNull(),
    recipientMobile: text('recipient_mobile').notNull(),
    messageText: text('message_text').notNull(),
    clickToChatUrl: text('click_to_chat_url').notNull(),
    status: text('status')
      .$type<'PREPARED' | 'SENT' | 'FAILED' | 'SKIPPED'>()
      .notNull(),
    amountOwedPaise: integer('amount_owed_paise').notNull(),
    paidLastWeekPaise: integer('paid_last_week_paise').notNull(),
    interestThisMonthPaise: integer('interest_this_month_paise').notNull(),
    nextDueDate: text('next_due_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_message_logs_weekly_loan').on(
      table.cycleId,
      table.memberId,
      table.loanId,
      table.weekKey
    ),
  ]
);

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorMemberId: uuid('actor_member_id').references(() => members.id),
  actorRole: text('actor_role').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  valueJson: jsonb('value_json').$type<unknown>().notNull(),
  updatedByAdminId: uuid('updated_by_admin_id').references(() => members.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id),
  role: text('role').$type<'ADMIN' | 'MEMBER'>().notNull(),
  totpVerified: boolean('totp_verified').notNull().default(false),
  mustChangePin: boolean('must_change_pin').notNull().default(false),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

