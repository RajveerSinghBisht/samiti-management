import { describe, expect, it } from 'vitest';
import {
  calculateInterestShares,
  calculateLoanAccruedInterestForMonth,
  calculateLoanBalance,
  allocateRepayment,
  type CalcLedgerEntry,
} from '@/lib/calc';
import { roundHalfUp, formatPaiseToInr } from '@/lib/money';

/**
 * LOCKED STEP 0 ACCEPTANCE TESTS — HUMAN-SUPPLIED WORKED EXAMPLES
 *
 * Notice on human-supplied Example 1:
 * The prompt states:
 *   "Example 1: Monthly contribution Rs.1000, members 20, a loan of Rs.10000
 *    taken on 10 october, 2026 at 3 percent per month, repaid Rs 5000 on 1 november, 2026."
 * Because partial-month accrual and mid-month repayment timing are not specified in the prompt,
 * these tests encode the unambiguous rule documented in docs/RULES.md (daily calendar-day
 * pro-rata per calendar month with round half up per monthly accrual entry, interest-first
 * repayment allocation) and are flagged as [NEEDS HUMAN CONFIRMATION] against the group's
 * real historical practice.
 */
describe('Human-supplied worked examples', () => {
  it('Example 1 [NEEDS HUMAN CONFIRMATION on partial-month rule]: 20 members @ Rs 1000/mo, Rs 10000 loan on 10 Oct 2026 @ 3%/mo, Rs 5000 repaid 1 Nov 2026', () => {
    const monthlyContributionPaise = 100_000; // Rs 1,000
    const memberCount = 20;
    const monthlyPoolPaise = monthlyContributionPaise * memberCount; // Rs 20,000 = 2,000,000 paise
    expect(monthlyPoolPaise).toBe(2_000_000);

    const loanId = 'loan-ex-1';
    const memberId = 'member-1';
    const principalPaise = 1_000_000; // Rs 10,000
    const interestRateBps = 300; // 3% per month

    // Step 1: Disbursement on 2026-10-10
    const entries: CalcLedgerEntry[] = [
      {
        id: 'e-disb',
        memberId,
        loanId,
        entryType: 'LOAN_DISBURSEMENT',
        amountPaise: principalPaise,
        effectiveDate: '2026-10-10',
      },
    ];

    // Step 2: October 2026 accrual (October has 31 days; active 10 Oct .. 31 Oct = 22 days)
    // Arithmetic:
    //   weightedPrincipalDays = 1,000,000 paise * 22 days = 22,000,000
    //   octInterest = roundHalfUp(22,000,000 * 300, 10,000 * 31)
    //               = roundHalfUp(6,600,000,000, 310,000)
    //               = floor((13,200,000,000 + 310,000) / 620,000)
    //               = 21,290 paise (Rs 212.90; exact = 21,290.32258...)
    const expectedOctInterest = roundHalfUp(
      1_000_000n * 300n * 22n,
      10_000n * 31n
    );
    expect(expectedOctInterest).toBe(21_290);

    const octInterest = calculateLoanAccruedInterestForMonth({
      loanId,
      disbursedDate: '2026-10-10',
      principalPaise,
      interestRateBps,
      interestMode: 'REDUCING_BALANCE',
      entries,
      year: 2026,
      month: 10,
    });
    expect(octInterest).toBe(21_290);

    // Record October month-end INTEREST_ACCRUAL on 2026-10-31
    entries.push({
      id: 'e-acc-oct',
      memberId,
      loanId,
      entryType: 'INTEREST_ACCRUAL',
      amountPaise: octInterest,
      effectiveDate: '2026-10-31',
    });

    // Step 3: On morning of 2026-11-01 (before November day completes), unpaid accrued interest = 21,290 paise
    const balanceBeforeRepayment = calculateLoanBalance({
      loanId,
      disbursedDate: '2026-10-10',
      principalPaise,
      interestRateBps,
      interestMode: 'REDUCING_BALANCE',
      entries,
      asOfDate: '2026-11-01',
    });
    expect(balanceBeforeRepayment.outstandingPrincipalPaise).toBe(1_000_000);
    expect(balanceBeforeRepayment.unpaidAccruedInterestPaise).toBe(21_290);
    expect(balanceBeforeRepayment.totalOwedPaise).toBe(1_021_290);

    // Repayment of Rs 5,000 (500,000 paise) on 2026-11-01:
    // Interest-first allocation:
    //   interestPaid = min(500,000, 21,290) = 21,290 paise
    //   principalPaid = 500,000 - 21,290 = 478,710 paise
    const allocation = allocateRepayment({
      paymentAmountPaise: 500_000,
      outstandingPrincipalPaise: balanceBeforeRepayment.outstandingPrincipalPaise,
      unpaidInterestPaise: balanceBeforeRepayment.unpaidAccruedInterestPaise,
    });
    expect(allocation.interestPaidPaise).toBe(21_290);
    expect(allocation.principalPaidPaise).toBe(478_710);

    entries.push(
      {
        id: 'e-rep-int',
        memberId,
        loanId,
        entryType: 'REPAYMENT_INTEREST',
        amountPaise: allocation.interestPaidPaise,
        effectiveDate: '2026-11-01',
      },
      {
        id: 'e-rep-prin',
        memberId,
        loanId,
        entryType: 'REPAYMENT_PRINCIPAL',
        amountPaise: allocation.principalPaidPaise,
        effectiveDate: '2026-11-01',
      }
    );

    // Remaining principal on 2026-11-01 = 1,000,000 - 478,710 = 521,290 paise (Rs 5,212.90)
    const balanceAfterRepayment = calculateLoanBalance({
      loanId,
      disbursedDate: '2026-10-10',
      principalPaise,
      interestRateBps,
      interestMode: 'REDUCING_BALANCE',
      entries,
      asOfDate: '2026-11-01',
    });
    expect(balanceAfterRepayment.outstandingPrincipalPaise).toBe(521_290);
    expect(balanceAfterRepayment.unpaidAccruedInterestPaise).toBe(0);
    expect(formatPaiseToInr(balanceAfterRepayment.outstandingPrincipalPaise)).toBe('₹5,212.90');

    // Step 4: November 2026 accrual (30 days in Nov, principal = 521,290 paise for all 30 days)
    // Arithmetic (REDUCING_BALANCE):
    //   novInterest = roundHalfUp(521,290 * 300 * 30, 10,000 * 30)
    //               = roundHalfUp(156,387,000, 10,000)
    //               = 15,639 paise (exact = 15,638.7)
    const novInterestReducing = calculateLoanAccruedInterestForMonth({
      loanId,
      disbursedDate: '2026-10-10',
      principalPaise,
      interestRateBps,
      interestMode: 'REDUCING_BALANCE',
      entries,
      year: 2026,
      month: 11,
    });
    expect(novInterestReducing).toBe(15_639);

    // Arithmetic (FLAT):
    //   novInterestFlat = roundHalfUp(1,000,000 * 300 * 30, 10,000 * 30) = 30,000 paise (Rs 300)
    const novInterestFlat = calculateLoanAccruedInterestForMonth({
      loanId,
      disbursedDate: '2026-10-10',
      principalPaise,
      interestRateBps,
      interestMode: 'FLAT',
      entries,
      year: 2026,
      month: 11,
    });
    expect(novInterestFlat).toBe(30_000);
  });

  it('Example 2 (end of cycle): total interest collected Rs 1,00,000, equal contributions -> equal share for every member', () => {
    const totalInterestPoolPaise = 10_000_000; // Rs 1,00,000

    // Case A: 20 members with equal contributions (Rs 1,000 * 12 = Rs 12,000 each)
    const twentyMembers = Array.from({ length: 20 }, (_, idx) => ({
      memberId: `member-${String(idx + 1).padStart(2, '0')}`,
      totalContributedPaise: 1_200_000,
    }));

    const shares20Proportional = calculateInterestShares({
      totalInterestPoolPaise,
      members: twentyMembers,
      sharingMode: 'PROPORTIONAL_CONTRIBUTION',
    });
    expect(shares20Proportional).toHaveLength(20);
    for (const share of shares20Proportional) {
      expect(share.sharePaise).toBe(500_000); // Rs 5,000 each
    }
    expect(shares20Proportional.reduce((acc, s) => acc + s.sharePaise, 0)).toBe(
      totalInterestPoolPaise
    );

    const shares20Equal = calculateInterestShares({
      totalInterestPoolPaise,
      members: twentyMembers,
      sharingMode: 'EQUAL',
    });
    for (const share of shares20Equal) {
      expect(share.sharePaise).toBe(500_000);
    }

    // Case B: 4 members (A, B, C, D) with identical contributions -> Rs 25,000 each
    const fourMembers = ['A', 'B', 'C', 'D'].map((id) => ({
      memberId: id,
      totalContributedPaise: 2_400_000,
    }));
    const shares4 = calculateInterestShares({
      totalInterestPoolPaise,
      members: fourMembers,
      sharingMode: 'PROPORTIONAL_CONTRIBUTION',
    });
    expect(shares4.map((s) => s.sharePaise)).toEqual([
      2_500_000,
      2_500_000,
      2_500_000,
      2_500_000,
    ]);
  });
});

