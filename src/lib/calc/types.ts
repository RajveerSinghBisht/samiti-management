export const INTEREST_MODES = ['REDUCING_BALANCE', 'FLAT'] as const;
export type InterestMode = (typeof INTEREST_MODES)[number];

export const INTEREST_SHARING_MODES = ['PROPORTIONAL_CONTRIBUTION', 'EQUAL'] as const;
export type InterestSharingMode = (typeof INTEREST_SHARING_MODES)[number];

export const LATE_RULE_MODES = ['NONE', 'FIXED_PAISA', 'PERCENT_BPS'] as const;
export type LateRuleMode = (typeof LATE_RULE_MODES)[number];

export const LEDGER_ENTRY_TYPES = [
  'CONTRIBUTION',
  'LOAN_DISBURSEMENT',
  'REPAYMENT_PRINCIPAL',
  'REPAYMENT_INTEREST',
  'INTEREST_ACCRUAL',
  'ROTATION_PAYOUT',
  'SHARE_PAYOUT',
  'REVERSAL',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export interface CycleSettings {
  startDate: string; // IST YYYY-MM-DD
  lengthMonths: number; // e.g., 12, 24, 60
  monthlyContributionPaise: number;
  interestRateBps: number; // e.g., 300 = 3.00% per month
  interestMode: InterestMode;
  interestSharingMode: InterestSharingMode;
  rotationPayoutEnabled: boolean;
  lateRuleMode: LateRuleMode;
  lateRuleValue: number; // paise for FIXED_PAISA, bps for PERCENT_BPS
}

export interface CalcLedgerEntry {
  id: string;
  memberId: string | null;
  loanId: string | null;
  entryType: LedgerEntryType;
  amountPaise: number;
  effectiveDate: string; // IST YYYY-MM-DD
  monthIndex?: number | null;
  reversesEntryId?: string | null;
  createdAt?: string;
}

export interface LoanSpec {
  id: string;
  memberId: string;
  disbursedDate: string;
  principalPaise: number;
  interestRateBps: number;
  interestMode: InterestMode;
}

export interface LoanBalanceResult {
  principalDisbursedPaise: number;
  principalRepaidPaise: number;
  outstandingPrincipalPaise: number;
  postedInterestAccruedPaise: number;
  computedInterestAccruedPaise: number;
  interestRepaidPaise: number;
  unpaidPostedInterestPaise: number;
  unpaidAccruedInterestPaise: number;
  totalOwedPaise: number;
}

export interface MemberSavingsResult {
  totalContributedPaise: number;
  totalSharePayoutPaise: number;
  totalRotationReceivedPaise: number;
  contributionCount: number;
}

export interface GroupTotals {
  totalContributionsPaise: number;
  totalLoansDisbursedPaise: number;
  totalPrincipalRepaidPaise: number;
  totalOutstandingPrincipalPaise: number;
  totalInterestCollectedPaise: number;
  totalRotationPayoutsPaise: number;
  totalSharePayoutsPaise: number;
  treasurerCashOnHandPaise: number;
  totalPoolEquityPaise: number;
}

