import { desc, eq } from 'drizzle-orm';
import { cycles, getDb, loans, members, messageLogs } from '@/db';
import {
  calculateLoanAccruedInterestForMonth,
  calculateLoanBalance,
  resolveActiveEntries,
} from '@/lib/calc';
import {
  addDaysIst,
  addMonthsIst,
  formatDisplayDate,
  getIstIsoWeekKey,
  parseIstDateParts,
  toIstDateString,
} from '@/lib/dates';
import { getEnv } from '@/lib/env';
import { formatPaiseToInr } from '@/lib/money';
import { recordAuditEvent } from './audit';
import { getCycleLedgerEntries } from './ledger';
import { getMessagingProviderMode } from './settings';

export interface ReminderPayload {
  memberName: string;
  recipientMobile: string;
  amountOwedPaise: number;
  paidLastWeekPaise: number;
  interestThisMonthPaise: number;
  nextDueDate: string;
  messageText: string;
  clickToChatUrl: string;
}

export interface MessagingProvider {
  readonly mode: 'PREPARE' | 'SEND';
  dispatch(payload: ReminderPayload): Promise<{
    status: 'PREPARED' | 'SENT' | 'FAILED';
    error?: string;
  }>;
}

export class PrepareMessagingProvider implements MessagingProvider {
  public readonly mode = 'PREPARE' as const;

  async dispatch(): Promise<{ status: 'PREPARED' }> {
    return { status: 'PREPARED' };
  }
}

export class SendMessagingProvider implements MessagingProvider {
  public readonly mode = 'SEND' as const;

  async dispatch(): Promise<{ status: 'SENT' | 'FAILED'; error?: string }> {
    const env = getEnv();
    if (!env.WHATSAPP_API_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
      return {
        status: 'FAILED',
        error: 'Automated send provider is disabled until WhatsApp Cloud API credentials are configured.',
      };
    }
    // Live external sending intentionally requires explicit operator credentials;
    // avoid unverified network calls unless configured in production.
    return {
      status: 'FAILED',
      error: 'Direct send endpoint requires verified template approval in Meta WhatsApp Cloud API.',
    };
  }
}

export function buildClickToChatUrl(mobile10Digits: string, messageText: string): string {
  const digits = mobile10Digits.replace(/\D/g, '');
  const e164 = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${e164}?text=${encodeURIComponent(messageText)}`;
}

export function buildLoanReminderText(input: {
  memberName: string;
  amountOwedPaise: number;
  paidLastWeekPaise: number;
  interestThisMonthPaise: number;
  nextDueDate: string;
}): string {
  return [
    `Namaste ${input.memberName},`,
    `Samiti Loan Update:`,
    `- Amount still owed: ${formatPaiseToInr(input.amountOwedPaise)}`,
    `- Paid in last 7 days: ${formatPaiseToInr(input.paidLastWeekPaise)}`,
    `- Interest this month: ${formatPaiseToInr(input.interestThisMonthPaise)}`,
    `- Next due date: ${formatDisplayDate(input.nextDueDate, 'en')}`,
  ].join('\n');
}

export async function runWeeklyReminders(input: {
  now?: Date;
  providerMode?: 'prepare' | 'send';
} = {}) {
  const now = input.now ?? new Date();
  const asOfDate = toIstDateString(now);
  const weekKey = getIstIsoWeekKey(asOfDate);
  const weekStartDate = addDaysIst(asOfDate, -7);
  const { year, month } = parseIstDateParts(asOfDate);
  const nextDueDate = addMonthsIst(`${year}-${String(month).padStart(2, '0')}-05`, 1);

  const db = getDb();
  const mode = input.providerMode ?? (await getMessagingProviderMode(db));
  const provider: MessagingProvider =
    mode === 'send' ? new SendMessagingProvider() : new PrepareMessagingProvider();

  const activeCycles = await db.select().from(cycles).where(eq(cycles.status, 'ACTIVE'));
  const memberRows = await db.select().from(members);
  const memberMap = new Map(memberRows.map((m) => [m.id, m]));

  let createdCount = 0;
  let skippedDuplicates = 0;
  const createdLogs = [];

  for (const cycle of activeCycles) {
    const cycleLoans = await db.select().from(loans).where(eq(loans.cycleId, cycle.id));
    const activeLoans = cycleLoans.filter((l) => l.status === 'ACTIVE');
    if (activeLoans.length === 0) continue;

    const entries = await getCycleLedgerEntries(cycle.id, db);
    const activeEntries = resolveActiveEntries(entries, asOfDate);

    for (const loan of activeLoans) {
      const member = memberMap.get(loan.memberId);
      if (!member || member.status !== 'ACTIVE') continue;

      const bal = calculateLoanBalance({
        loanId: loan.id,
        disbursedDate: loan.disbursedDate,
        principalPaise: loan.principalPaise,
        interestRateBps: loan.interestRateBps,
        interestMode: loan.interestMode,
        entries,
        asOfDate,
      });

      if (bal.totalOwedPaise <= 0) continue;

      let paidLastWeekPaise = 0;
      for (const e of activeEntries) {
        if (
          e.loanId === loan.id &&
          (e.entryType === 'REPAYMENT_PRINCIPAL' || e.entryType === 'REPAYMENT_INTEREST') &&
          e.effectiveDate >= weekStartDate &&
          e.effectiveDate <= asOfDate
        ) {
          paidLastWeekPaise += e.amountPaise;
        }
      }

      const interestThisMonthPaise = calculateLoanAccruedInterestForMonth({
        loanId: loan.id,
        disbursedDate: loan.disbursedDate,
        principalPaise: loan.principalPaise,
        interestRateBps: loan.interestRateBps,
        interestMode: loan.interestMode,
        entries: activeEntries,
        year,
        month,
        exclusiveCutoffDate: addDaysIst(asOfDate, 1),
      });

      const messageText = buildLoanReminderText({
        memberName: member.name,
        amountOwedPaise: bal.totalOwedPaise,
        paidLastWeekPaise,
        interestThisMonthPaise,
        nextDueDate,
      });
      const clickToChatUrl = buildClickToChatUrl(member.mobile, messageText);

      const dispatchResult = await provider.dispatch({
        memberName: member.name,
        recipientMobile: member.mobile,
        amountOwedPaise: bal.totalOwedPaise,
        paidLastWeekPaise,
        interestThisMonthPaise,
        nextDueDate,
        messageText,
        clickToChatUrl,
      });

      const inserted = await db
        .insert(messageLogs)
        .values({
          cycleId: cycle.id,
          memberId: member.id,
          loanId: loan.id,
          weekKey,
          channelMode: provider.mode,
          recipientMobile: member.mobile,
          messageText,
          clickToChatUrl,
          status: dispatchResult.status,
          amountOwedPaise: bal.totalOwedPaise,
          paidLastWeekPaise,
          interestThisMonthPaise,
          nextDueDate,
        })
        .onConflictDoNothing({
          target: [
            messageLogs.cycleId,
            messageLogs.memberId,
            messageLogs.loanId,
            messageLogs.weekKey,
          ],
        })
        .returning();

      const log = inserted.at(0);
      if (log) {
        createdCount += 1;
        createdLogs.push(log);
      } else {
        skippedDuplicates += 1;
      }
    }
  }

  await recordAuditEvent({
    actorMemberId: null,
    actorRole: 'CRON',
    action: 'WEEKLY_REMINDERS_JOB',
    targetType: 'message_logs',
    metadata: { weekKey, mode: provider.mode, createdCount, skippedDuplicates },
  });

  return {
    weekKey,
    createdCount,
    skippedDuplicates,
    logs: createdLogs,
  };
}

export async function listMessageLogs(limit = 200) {
  const db = getDb();
  const rows = await db
    .select()
    .from(messageLogs)
    .orderBy(desc(messageLogs.createdAt))
    .limit(limit);
  const memberRows = await db
    .select({ id: members.id, name: members.name })
    .from(members);
  const memberMap = new Map(memberRows.map((m) => [m.id, m.name]));
  return rows.map((r) => ({
    ...r,
    memberName: memberMap.get(r.memberId) ?? 'Member',
  }));
}

