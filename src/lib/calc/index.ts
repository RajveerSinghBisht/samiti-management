import { resolveActiveEntries } from './ledger-replay';
import type { CalcLedgerEntry, CycleSettings, GroupTotals, LoanSpec } from './types';

export * from './types';
export * from './ledger-replay';
export * from './interest';
export * from './sharing';
export * from './rotation';

/**
 * Computes group-wide cash, loan, contribution, interest, and equity totals from active ledger entries.
 * Satisfies: treasurerCashOnHandPaise + totalOutstandingPrincipalPaise === totalPoolEquityPaise.
 */
export function calculateGroupTotals(input: {
  entries: ReadonlyArray<CalcLedgerEntry>;
  settings: CycleSettings;
  loans: ReadonlyArray<LoanSpec>;
  asOfDate: string;
}): GroupTotals {
  const active = resolveActiveEntries(input.entries, input.asOfDate);

  let totalContributionsPaise = 0;
  let totalLoansDisbursedPaise = 0;
  let totalPrincipalRepaidPaise = 0;
  let totalInterestCollectedPaise = 0;
  let totalBankInterestPaise = 0;
  let totalGoodCauseGrantsPaise = 0;
  let totalRotationPayoutsPaise = 0;
  let totalSharePayoutsPaise = 0;

  for (const entry of active) {
    switch (entry.entryType) {
      case 'CONTRIBUTION':
        totalContributionsPaise += entry.amountPaise;
        break;
      case 'LOAN_DISBURSEMENT':
        totalLoansDisbursedPaise += entry.amountPaise;
        break;
      case 'REPAYMENT_PRINCIPAL':
        totalPrincipalRepaidPaise += entry.amountPaise;
        break;
      case 'REPAYMENT_INTEREST':
        totalInterestCollectedPaise += entry.amountPaise;
        break;
      case 'BANK_INTEREST':
        totalBankInterestPaise += entry.amountPaise;
        break;
      case 'GOOD_CAUSE_GRANT':
        totalGoodCauseGrantsPaise += entry.amountPaise;
        break;
      case 'ROTATION_PAYOUT':
        totalRotationPayoutsPaise += entry.amountPaise;
        break;
      case 'SHARE_PAYOUT':
        totalSharePayoutsPaise += entry.amountPaise;
        break;
      default:
        break;
    }
  }

  const totalOutstandingPrincipalPaise = Math.max(
    0,
    totalLoansDisbursedPaise - totalPrincipalRepaidPaise
  );

  const treasurerCashOnHandPaise =
    totalContributionsPaise +
    totalInterestCollectedPaise +
    totalBankInterestPaise +
    totalPrincipalRepaidPaise -
    totalLoansDisbursedPaise -
    totalGoodCauseGrantsPaise -
    totalRotationPayoutsPaise -
    totalSharePayoutsPaise;

  const poolAvailableToLendPaise =
    totalContributionsPaise +
    totalInterestCollectedPaise +
    totalBankInterestPaise +
    totalPrincipalRepaidPaise -
    totalLoansDisbursedPaise -
    totalGoodCauseGrantsPaise;

  const totalPoolEquityPaise =
    treasurerCashOnHandPaise + totalOutstandingPrincipalPaise;

  return {
    totalContributionsPaise,
    totalLoansDisbursedPaise,
    totalPrincipalRepaidPaise,
    totalOutstandingPrincipalPaise,
    totalInterestCollectedPaise,
    totalBankInterestPaise,
    totalGoodCauseGrantsPaise,
    totalRotationPayoutsPaise,
    totalSharePayoutsPaise,
    treasurerCashOnHandPaise,
    poolAvailableToLendPaise,
    totalPoolEquityPaise,
  };
}

