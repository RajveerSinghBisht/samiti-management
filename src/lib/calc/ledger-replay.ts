import type { CalcLedgerEntry, LedgerEntryType, MemberSavingsResult } from './types';

function canonicalEntryOrder(entryType: LedgerEntryType): number {
  switch (entryType) {
    case 'CONTRIBUTION':
      return 1;
    case 'LOAN_DISBURSEMENT':
      return 2;
    case 'INTEREST_ACCRUAL':
      return 3;
    case 'REPAYMENT_INTEREST':
      return 4;
    case 'REPAYMENT_PRINCIPAL':
      return 5;
    case 'ROTATION_PAYOUT':
      return 6;
    case 'SHARE_PAYOUT':
      return 7;
    case 'REVERSAL':
      return 8;
    case 'BANK_INTEREST':
      return 9;
    case 'GOOD_CAUSE_GRANT':
      return 10;
    default:
      return 99;
  }
}

/**
 * Resolves all active (non-reversed) ledger entries up to `asOfDate` (inclusive, if provided).
 * Reversed entries and their REVERSAL markers are both excluded, and the result is sorted
 * deterministically by (effectiveDate ASC, canonicalEntryType ASC, id ASC) so results are
 * strictly independent of entry insertion order within any IST day.
 */
export function resolveActiveEntries(
  entries: ReadonlyArray<CalcLedgerEntry>,
  asOfDate?: string
): CalcLedgerEntry[] {
  const scoped = asOfDate
    ? entries.filter((e) => e.effectiveDate <= asOfDate)
    : [...entries];

  const reversedTargetIds = new Set<string>();
  for (const entry of scoped) {
    if (entry.entryType === 'REVERSAL' && entry.reversesEntryId) {
      reversedTargetIds.add(entry.reversesEntryId);
    }
  }

  return scoped
    .filter((entry) => entry.entryType !== 'REVERSAL' && !reversedTargetIds.has(entry.id))
    .sort((a, b) => {
      const dateCmp = a.effectiveDate.localeCompare(b.effectiveDate, 'en');
      if (dateCmp !== 0) return dateCmp;
      const typeCmp = canonicalEntryOrder(a.entryType) - canonicalEntryOrder(b.entryType);
      if (typeCmp !== 0) return typeCmp;
      return a.id.localeCompare(b.id, 'en');
    });
}

/**
 * Derives a member's savings, share payouts, and rotation payouts from active ledger entries.
 */
export function calculateMemberSavings(
  entries: ReadonlyArray<CalcLedgerEntry>,
  memberId: string,
  asOfDate?: string
): MemberSavingsResult {
  const active = resolveActiveEntries(entries, asOfDate);
  let totalContributedPaise = 0;
  let totalSharePayoutPaise = 0;
  let totalRotationReceivedPaise = 0;
  let contributionCount = 0;

  for (const entry of active) {
    if (entry.memberId !== memberId) continue;
    if (entry.entryType === 'CONTRIBUTION') {
      totalContributedPaise += entry.amountPaise;
      contributionCount += 1;
    } else if (entry.entryType === 'SHARE_PAYOUT') {
      totalSharePayoutPaise += entry.amountPaise;
    } else if (entry.entryType === 'ROTATION_PAYOUT') {
      totalRotationReceivedPaise += entry.amountPaise;
    }
  }

  return {
    totalContributedPaise,
    totalSharePayoutPaise,
    totalRotationReceivedPaise,
    contributionCount,
  };
}

