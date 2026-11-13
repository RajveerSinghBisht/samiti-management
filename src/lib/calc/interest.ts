import { addDaysIst, daysInMonth } from '@/lib/dates';
import { roundHalfUp } from '@/lib/money';
import { resolveActiveEntries } from './ledger-replay';
import type { CalcLedgerEntry, InterestMode, LoanBalanceResult } from './types';

/**
 * Authoritative Samiti Rule 4:
 * Interest due at meeting N for a loan = rate x principal outstanding at close of meeting N-1
 * (before any repayment at meeting N).
 * Rounded half up to paise. No proration, no compounding.
 */
export function calculateLoanMeetingInterestDue(input: {
  principalPaise: number;
  interestRateBps: number;
  interestMode?: InterestMode;
  outstandingPrincipalPaise: number;
  isDisbursementMeeting?: boolean;
}): number {
  if (input.isDisbursementMeeting) {
    return 0;
  }
  const basePaise =
    input.interestMode === 'FLAT' ? input.principalPaise : input.outstandingPrincipalPaise;
  if (basePaise <= 0 || input.interestRateBps <= 0) {
    return 0;
  }
  return roundHalfUp(BigInt(basePaise) * BigInt(input.interestRateBps), 10_000n);
}

/**
 * Authoritative Samiti Rules 3, 4, 5:
 * Evaluates interest due and unpaid prior interest carried forward for a loan at a meeting date.
 */
export function calculateLoanInterestDueAtMeeting(input: {
  loanId: string;
  disbursedDate: string;
  principalPaise: number;
  interestRateBps: number;
  interestMode?: InterestMode;
  entries: ReadonlyArray<CalcLedgerEntry>;
  meetingDate: string;
}): {
  interestDuePaise: number;
  unpaidPriorInterestPaise: number;
  totalInterestDuePaise: number;
  outstandingPrincipalPaise: number;
} {
  // If meeting is on or before disbursement date: no interest due per Rule 3
  if (input.meetingDate <= input.disbursedDate) {
    const bal = calculateLoanBalance({
      loanId: input.loanId,
      disbursedDate: input.disbursedDate,
      principalPaise: input.principalPaise,
      interestRateBps: input.interestRateBps,
      interestMode: input.interestMode ?? 'REDUCING_BALANCE',
      entries: input.entries,
      asOfDate: input.meetingDate,
    });
    return {
      interestDuePaise: 0,
      unpaidPriorInterestPaise: 0,
      totalInterestDuePaise: 0,
      outstandingPrincipalPaise: bal.outstandingPrincipalPaise,
    };
  }

  // Active entries prior to this meeting (representing state at close of meeting N-1)
  const priorBal = calculateLoanBalance({
    loanId: input.loanId,
    disbursedDate: input.disbursedDate,
    principalPaise: input.principalPaise,
    interestRateBps: input.interestRateBps,
    interestMode: input.interestMode ?? 'REDUCING_BALANCE',
    entries: input.entries.filter((e) => e.effectiveDate < input.meetingDate),
    asOfDate: input.meetingDate,
  });

  const basePrincipal =
    input.interestMode === 'FLAT' ? input.principalPaise : priorBal.outstandingPrincipalPaise;
  const currentMeetingInterest =
    basePrincipal > 0 && input.interestRateBps > 0
      ? roundHalfUp(BigInt(basePrincipal) * BigInt(input.interestRateBps), 10_000n)
      : 0;

  const unpaidPriorInterestPaise = priorBal.unpaidAccruedInterestPaise;
  const totalInterestDuePaise = currentMeetingInterest + unpaidPriorInterestPaise;

  return {
    interestDuePaise: currentMeetingInterest,
    unpaidPriorInterestPaise,
    totalInterestDuePaise,
    outstandingPrincipalPaise: priorBal.outstandingPrincipalPaise,
  };
}

function formatMonthBounds(year: number, month: number): {
  monthStart: string;
  monthEnd: string;
  totalDays: number;
} {
  const totalDays = daysInMonth(year, month);
  const mm = String(month).padStart(2, '0');
  return {
    monthStart: `${year}-${mm}-01`,
    monthEnd: `${year}-${mm}-${String(totalDays).padStart(2, '0')}`,
    totalDays,
  };
}

/**
 * Builds a deterministic map of IST date -> net principal change (+disbursed - principalRepaid)
 * for a specific loan. Independent of entry order within any day.
 */
function buildDailyPrincipalDeltaMap(
  loanId: string,
  entries: ReadonlyArray<CalcLedgerEntry>
): {
  deltaByDate: Map<string, number>;
  hasExplicitDisbursement: boolean;
} {
  const hasExplicitDisbursement = entries.some(
    (e) => e.loanId === loanId && e.entryType === 'LOAN_DISBURSEMENT'
  );
  const active = resolveActiveEntries(entries);
  const deltaByDate = new Map<string, number>();

  for (const entry of active) {
    if (entry.loanId !== loanId) continue;
    if (entry.entryType === 'LOAN_DISBURSEMENT') {
      deltaByDate.set(
        entry.effectiveDate,
        (deltaByDate.get(entry.effectiveDate) ?? 0) + entry.amountPaise
      );
    } else if (entry.entryType === 'REPAYMENT_PRINCIPAL') {
      deltaByDate.set(
        entry.effectiveDate,
        (deltaByDate.get(entry.effectiveDate) ?? 0) - entry.amountPaise
      );
    }
  }

  return { deltaByDate, hasExplicitDisbursement };
}

/**
 * Computes interest accrued for a single calendar month `(year, month)` up to an optional
 * exclusive cutoff date `exclusiveCutoffDate` (when omitted, covers the full calendar month).
 *
 * Method & Rounding (docs/RULES.md §4.2):
 * - For each calendar day d in [monthStart, min(monthEnd, cutoff - 1)], evaluate the loan's
 *   end-of-day outstanding principal P_d on date d.
 * - Under REDUCING_BALANCE: daily weight = P_d (if P_d > 0).
 * - Under FLAT: daily weight = principalPaise on every day where P_d > 0.
 * - Sum daily weights across the month and compute:
 *     roundHalfUp(weightedSum * interestRateBps, 10000 * daysInMonth)
 */
export function calculateLoanAccruedInterestForMonth(input: {
  loanId: string;
  disbursedDate: string;
  principalPaise: number;
  interestRateBps: number;
  interestMode: InterestMode;
  entries: ReadonlyArray<CalcLedgerEntry>;
  year: number;
  month: number;
  exclusiveCutoffDate?: string;
}): number {
  const { monthStart, monthEnd, totalDays } = formatMonthBounds(input.year, input.month);
  const effectiveEnd =
    input.exclusiveCutoffDate && input.exclusiveCutoffDate <= monthEnd
      ? addDaysIst(input.exclusiveCutoffDate, -1)
      : monthEnd;

  if (effectiveEnd < input.disbursedDate || effectiveEnd < monthStart) {
    return 0;
  }

  const { deltaByDate, hasExplicitDisbursement } = buildDailyPrincipalDeltaMap(
    input.loanId,
    input.entries
  );

  // If no explicit LOAN_DISBURSEMENT row was ever recorded in raw entries, treat disbursedDate as initial principal
  if (!hasExplicitDisbursement && input.principalPaise > 0) {
    deltaByDate.set(
      input.disbursedDate,
      (deltaByDate.get(input.disbursedDate) ?? 0) + input.principalPaise
    );
  }

  const sortedDates = Array.from(deltaByDate.keys()).sort((a, b) => a.localeCompare(b, 'en'));
  let runningPrincipal = 0;
  let dateCursor = 0;

  while (dateCursor < sortedDates.length) {
    const d = sortedDates.at(dateCursor);
    if (!d || d >= monthStart) break;
    runningPrincipal = Math.max(0, runningPrincipal + (deltaByDate.get(d) ?? 0));
    dateCursor += 1;
  }

  let weightedPrincipalDays = 0n;
  for (let day = 1; day <= totalDays; day++) {
    const currentIst = `${input.year}-${String(input.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (currentIst > effectiveEnd) break;

    while (dateCursor < sortedDates.length) {
      const d = sortedDates.at(dateCursor);
      if (!d || d > currentIst) break;
      runningPrincipal = Math.max(0, runningPrincipal + (deltaByDate.get(d) ?? 0));
      dateCursor += 1;
    }

    if (currentIst >= input.disbursedDate && runningPrincipal > 0) {
      const dayBase =
        input.interestMode === 'FLAT' ? input.principalPaise : runningPrincipal;
      weightedPrincipalDays += BigInt(dayBase);
    }
  }

  if (weightedPrincipalDays === 0n || input.interestRateBps <= 0) {
    return 0;
  }

  return roundHalfUp(
    weightedPrincipalDays * BigInt(input.interestRateBps),
    10_000n * BigInt(totalDays)
  );
}

/**
 * Derives a loan's full balance as of `asOfDate` (inclusive of entries on `asOfDate`,
 * and accrued interest strictly prior to `asOfDate` unless `includeAsOfDayInterest` is true).
 */
export function calculateLoanBalance(input: {
  loanId: string;
  disbursedDate: string;
  principalPaise: number;
  interestRateBps: number;
  interestMode: InterestMode;
  entries: ReadonlyArray<CalcLedgerEntry>;
  asOfDate: string;
  includeAsOfDayInterest?: boolean;
}): LoanBalanceResult {
  const activeUpToAsOf = resolveActiveEntries(input.entries, input.asOfDate);

  let principalDisbursedPaise = 0;
  let principalRepaidPaise = 0;
  let postedInterestAccruedPaise = 0;
  let interestRepaidPaise = 0;

  for (const entry of activeUpToAsOf) {
    if (entry.loanId !== input.loanId) continue;
    switch (entry.entryType) {
      case 'LOAN_DISBURSEMENT':
        principalDisbursedPaise += entry.amountPaise;
        break;
      case 'REPAYMENT_PRINCIPAL':
        principalRepaidPaise += entry.amountPaise;
        break;
      case 'INTEREST_ACCRUAL':
        postedInterestAccruedPaise += entry.amountPaise;
        break;
      case 'REPAYMENT_INTEREST':
        interestRepaidPaise += entry.amountPaise;
        break;
      default:
        break;
    }
  }

  const outstandingPrincipalPaise = Math.max(0, principalDisbursedPaise - principalRepaidPaise);

  const effectiveAccruedInterestPaise = postedInterestAccruedPaise;
  const computedInterestAccruedPaise = postedInterestAccruedPaise;

  const unpaidPostedInterestPaise = Math.max(
    0,
    postedInterestAccruedPaise - interestRepaidPaise
  );
  const unpaidAccruedInterestPaise = Math.max(
    0,
    effectiveAccruedInterestPaise - interestRepaidPaise
  );

  return {
    principalDisbursedPaise,
    principalRepaidPaise,
    outstandingPrincipalPaise,
    postedInterestAccruedPaise,
    computedInterestAccruedPaise,
    interestRepaidPaise,
    unpaidPostedInterestPaise,
    unpaidAccruedInterestPaise,
    totalOwedPaise: outstandingPrincipalPaise + unpaidAccruedInterestPaise,
  };
}

/**
 * Allocates a loan repayment strictly interest-first, then principal.
 * Throws if paymentAmountPaise <= 0 or exceeds total owed.
 */
export function allocateRepayment(input: {
  paymentAmountPaise: number;
  outstandingPrincipalPaise: number;
  unpaidInterestPaise: number;
}): { interestPaidPaise: number; principalPaidPaise: number } {
  if (!Number.isSafeInteger(input.paymentAmountPaise) || input.paymentAmountPaise <= 0) {
    throw new Error('Repayment amount must be a positive integer in paise');
  }
  const totalOwed = input.outstandingPrincipalPaise + input.unpaidInterestPaise;
  if (input.paymentAmountPaise > totalOwed) {
    throw new Error(
      `Repayment (${input.paymentAmountPaise} paise) exceeds total owed (${totalOwed} paise)`
    );
  }
  const interestPaidPaise = Math.min(input.paymentAmountPaise, input.unpaidInterestPaise);
  const principalPaidPaise = input.paymentAmountPaise - interestPaidPaise;
  return { interestPaidPaise, principalPaidPaise };
}

