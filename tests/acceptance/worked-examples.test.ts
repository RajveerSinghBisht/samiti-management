import { describe, expect, it } from 'vitest';
import {
  calculateInterestShares,
  calculateLoanBalance,
  calculateLoanInterestDueAtMeeting,
  type CalcLedgerEntry,
} from '@/lib/calc';
import { formatPaiseToInr } from '@/lib/money';

/**
 * LOCKED STEP 0 ACCEPTANCE TESTS — HUMAN-SUPPLIED WORKED EXAMPLES
 *
 * Updated under Human-Approved Rule Change B:
 * Encodes the Authoritative Samiti Rules:
 * 1. Time is organised by monthly physical meetings.
 * 2. Loans disbursed at a meeting carry NO interest for that meeting. Interest starts at the next meeting.
 * 3. Interest due at meeting N = rate x principal outstanding at close of meeting N-1 (before repayment at meeting N).
 *    Rounded half up to paise. No proration, no compounding.
 * 4. Payments are two separate entries, never auto-allocated: INTEREST PAID and PRINCIPAL REPAID.
 *    Unpaid interest carries forward as "interest due" (no interest on interest).
 */
describe('Human-supplied worked examples', () => {
  it('Authoritative Rule Example 1: 20 members @ Rs 1000/mo, Rs 10000 loan on 10 Oct 2026 @ 3%/mo, meeting-based interest & separate payments', () => {
    const monthlyContributionPaise = 100_000; // Rs 1,000
    const memberCount = 20;
    const monthlyPoolPaise = monthlyContributionPaise * memberCount; // Rs 20,000 = 2,000,000 paise
    expect(monthlyPoolPaise).toBe(2_000_000);

    const loanId = 'loan-ex-1';
    const memberId = 'member-1';
    const principalPaise = 1_000_000; // Rs 10,000
    const interestRateBps = 300; // 3% per month

    // Step 1: Disbursement at October meeting (2026-10-10)
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

    // Rule 3: No interest is due for the meeting of disbursement (October meeting)
    const octInterestDue = calculateLoanInterestDueAtMeeting({
      loanId,
      disbursedDate: '2026-10-10',
      principalPaise,
      interestRateBps,
      entries,
      meetingDate: '2026-10-10',
    });
    expect(octInterestDue.interestDuePaise).toBe(0);
    expect(octInterestDue.unpaidPriorInterestPaise).toBe(0);
    expect(octInterestDue.totalInterestDuePaise).toBe(0);

    // Step 2: November meeting (2026-11-01)
    // Rule 4: Interest due at meeting N = rate (3%) x principal outstanding at close of meeting N-1 (Rs 10,000)
    //         3% of Rs 10,000 = Rs 300 (30,000 paise). No proration, no compounding.
    const novInterestDue = calculateLoanInterestDueAtMeeting({
      loanId,
      disbursedDate: '2026-10-10',
      principalPaise,
      interestRateBps,
      entries,
      meetingDate: '2026-11-01',
    });
    expect(novInterestDue.interestDuePaise).toBe(30_000); // Rs 300
    expect(novInterestDue.unpaidPriorInterestPaise).toBe(0);
    expect(novInterestDue.totalInterestDuePaise).toBe(30_000);
    expect(novInterestDue.outstandingPrincipalPaise).toBe(1_000_000);

    // Rule 5: Payments are two separate entries, never auto-allocated
    // Borrower pays Rs 300 interest and repays Rs 5,000 principal
    entries.push(
      {
        id: 'e-rep-int',
        memberId,
        loanId,
        entryType: 'REPAYMENT_INTEREST',
        amountPaise: 30_000, // Rs 300
        effectiveDate: '2026-11-01',
      },
      {
        id: 'e-rep-prin',
        memberId,
        loanId,
        entryType: 'REPAYMENT_PRINCIPAL',
        amountPaise: 500_000, // Rs 5,000
        effectiveDate: '2026-11-01',
      }
    );

    // After November meeting repayments: outstanding principal is Rs 5,000
    const balanceAfterNov = calculateLoanBalance({
      loanId,
      disbursedDate: '2026-10-10',
      principalPaise,
      interestRateBps,
      interestMode: 'REDUCING_BALANCE',
      entries,
      asOfDate: '2026-11-01',
    });
    expect(balanceAfterNov.outstandingPrincipalPaise).toBe(500_000); // Rs 5,000
    expect(balanceAfterNov.unpaidAccruedInterestPaise).toBe(0);
    expect(formatPaiseToInr(balanceAfterNov.outstandingPrincipalPaise)).toBe('₹5,000');

    // Step 3: December meeting (2026-12-01)
    // Rule 4: Interest due at December meeting = 3% of Rs 5,000 = Rs 150 (15,000 paise)
    const decInterestDue = calculateLoanInterestDueAtMeeting({
      loanId,
      disbursedDate: '2026-10-10',
      principalPaise,
      interestRateBps,
      entries,
      meetingDate: '2026-12-01',
    });
    expect(decInterestDue.interestDuePaise).toBe(15_000); // Rs 150
    expect(decInterestDue.unpaidPriorInterestPaise).toBe(0);
    expect(decInterestDue.totalInterestDuePaise).toBe(15_000);
    expect(decInterestDue.outstandingPrincipalPaise).toBe(500_000);
  });

  it('Authoritative Rule Human-Supplied Example: 50 members @ Rs 1,000; Jan loans; Feb interest Rs 500; A repays Rs 5,000; March interest Rs 150; equal share Rs 10', () => {
    // 50 members, Rs 1,000 each -> Rs 50,000 collected at meeting
    const members50 = Array.from({ length: 50 }, (_, i) => `m-${i + 1}`);
    const totalCollectedMeetingPaise = 50 * 100_000; // Rs 50,000 = 5,000,000 paise
    expect(totalCollectedMeetingPaise).toBe(5_000_000);

    // January meeting (2026-01-10): A borrows Rs 20,000, B Rs 10,000, C Rs 20,000
    const loanAId = 'loan-A';
    const loanBId = 'loan-B';
    const loanCId = 'loan-C';
    const rateBps = 100; // default 1 percent per month

    const entries: CalcLedgerEntry[] = [
      { id: 'disb-A', memberId: 'm-A', loanId: loanAId, entryType: 'LOAN_DISBURSEMENT', amountPaise: 2_000_000, effectiveDate: '2026-01-10' },
      { id: 'disb-B', memberId: 'm-B', loanId: loanBId, entryType: 'LOAN_DISBURSEMENT', amountPaise: 1_000_000, effectiveDate: '2026-01-10' },
      { id: 'disb-C', memberId: 'm-C', loanId: loanCId, entryType: 'LOAN_DISBURSEMENT', amountPaise: 2_000_000, effectiveDate: '2026-01-10' },
    ];

    // Rule 3: No interest is due in January
    for (const [id, amt] of [[loanAId, 2_000_000], [loanBId, 1_000_000], [loanCId, 2_000_000]] as const) {
      const janDue = calculateLoanInterestDueAtMeeting({
        loanId: id,
        disbursedDate: '2026-01-10',
        principalPaise: amt,
        interestRateBps: rateBps,
        entries,
        meetingDate: '2026-01-10',
      });
      expect(janDue.interestDuePaise).toBe(0);
    }

    // February meeting (2026-02-10): interest due is Rs 200, Rs 100, and Rs 200 (Rs 500 total)
    const febDueA = calculateLoanInterestDueAtMeeting({
      loanId: loanAId,
      disbursedDate: '2026-01-10',
      principalPaise: 2_000_000,
      interestRateBps: rateBps,
      entries,
      meetingDate: '2026-02-10',
    });
    const febDueB = calculateLoanInterestDueAtMeeting({
      loanId: loanBId,
      disbursedDate: '2026-01-10',
      principalPaise: 1_000_000,
      interestRateBps: rateBps,
      entries,
      meetingDate: '2026-02-10',
    });
    const febDueC = calculateLoanInterestDueAtMeeting({
      loanId: loanCId,
      disbursedDate: '2026-01-10',
      principalPaise: 2_000_000,
      interestRateBps: rateBps,
      entries,
      meetingDate: '2026-02-10',
    });

    expect(febDueA.interestDuePaise).toBe(20_000); // Rs 200
    expect(febDueB.interestDuePaise).toBe(10_000); // Rs 100
    expect(febDueC.interestDuePaise).toBe(20_000); // Rs 200
    expect(febDueA.interestDuePaise + febDueB.interestDuePaise + febDueC.interestDuePaise).toBe(50_000); // Rs 500 total

    // A pays Rs 200 interest and repays Rs 5,000 principal
    entries.push(
      { id: 'rep-int-A', memberId: 'm-A', loanId: loanAId, entryType: 'REPAYMENT_INTEREST', amountPaise: 20_000, effectiveDate: '2026-02-10' },
      { id: 'rep-prin-A', memberId: 'm-A', loanId: loanAId, entryType: 'REPAYMENT_PRINCIPAL', amountPaise: 500_000, effectiveDate: '2026-02-10' }
    );

    // A's principal is now Rs 15,000
    const balAAfterFeb = calculateLoanBalance({
      loanId: loanAId,
      disbursedDate: '2026-01-10',
      principalPaise: 2_000_000,
      interestRateBps: rateBps,
      interestMode: 'REDUCING_BALANCE',
      entries,
      asOfDate: '2026-02-10',
    });
    expect(balAAfterFeb.outstandingPrincipalPaise).toBe(1_500_000); // Rs 15,000

    // March meeting (2026-03-10): A's March interest due is Rs 150
    const marchDueA = calculateLoanInterestDueAtMeeting({
      loanId: loanAId,
      disbursedDate: '2026-01-10',
      principalPaise: 2_000_000,
      interestRateBps: rateBps,
      entries,
      meetingDate: '2026-03-10',
    });
    expect(marchDueA.interestDuePaise).toBe(15_000); // Rs 150
    expect(marchDueA.outstandingPrincipalPaise).toBe(1_500_000);

    // Rs 500 of interest shared equally among 50 members is Rs 10 each
    const shares = calculateInterestShares({
      totalInterestPoolPaise: 50_000, // Rs 500
      members: members50.map((id) => ({ memberId: id, totalContributedPaise: 100_000 })),
      sharingMode: 'EQUAL',
    });
    expect(shares).toHaveLength(50);
    for (const s of shares) {
      expect(s.sharePaise).toBe(1_000); // Rs 10 each
    }
    expect(shares.reduce((acc, s) => acc + s.sharePaise, 0)).toBe(50_000);
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

