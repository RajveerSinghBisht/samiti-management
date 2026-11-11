import { describe, expect, it } from 'vitest';
import {
  INTEREST_MODES,
  INTEREST_SHARING_MODES,
  LATE_RULE_MODES,
  LEDGER_ENTRY_TYPES,
  allocateRepayment,
  calculateGroupTotals,
  calculateInterestShares,
  calculateLateFee,
  calculateLoanAccruedInterestForMonth,
  calculateLoanBalance,
  calculateMemberSavings,
  type CalcLedgerEntry,
  type CycleSettings,
} from '@/lib/calc';
import {
  addDaysIst,
  addMonthsIst,
  daysInMonth,
  diffDaysIst,
  formatDisplayDate,
  parseIstDateParts,
} from '@/lib/dates';
import {
  formatIndianDigits,
  formatPaiseToInr,
  parseStrictIntegerRupeesToPaise,
  roundHalfUp,
  splitLargestRemainder,
} from '@/lib/money';

describe('Unit coverage for money, dates, and pure calculation engine', () => {
  it('exposes canonical ledger and cycle mode enums', () => {
    expect(LEDGER_ENTRY_TYPES).toContain('CONTRIBUTION');
    expect(INTEREST_MODES).toEqual(['REDUCING_BALANCE', 'FLAT']);
    expect(INTEREST_SHARING_MODES).toEqual(['PROPORTIONAL_CONTRIBUTION', 'EQUAL']);
    expect(LATE_RULE_MODES).toEqual(['NONE', 'FIXED_PAISA', 'PERCENT_BPS']);
  });

  it('validates money edge cases and error paths', () => {
    expect(() => roundHalfUp(1.5, 2)).toThrow();
    expect(() => roundHalfUp(1, 2.5)).toThrow();
    expect(() => roundHalfUp(1n, 0n)).toThrow();
    expect(() => roundHalfUp(-1n, 2n)).toThrow();
    expect(() => roundHalfUp(BigInt(Number.MAX_SAFE_INTEGER) * 2n, 1n)).toThrow();

    expect(splitLargestRemainder(0, [])).toEqual([]);
    expect(() => splitLargestRemainder(100, [])).toThrow();
    expect(() => splitLargestRemainder(-1, [{ id: 'a', weight: 1 }])).toThrow();
    expect(() => splitLargestRemainder(100, [{ id: 'a', weight: 1.5 }])).toThrow();
    expect(() => splitLargestRemainder(100, [{ id: 'a', weight: -1 }])).toThrow();
    expect(
      splitLargestRemainder(0, [
        { id: 'a', weight: 0 },
        { id: 'b', weight: 0 },
      ])
    ).toEqual([
      { id: 'a', amountPaise: 0 },
      { id: 'b', amountPaise: 0 },
    ]);
    expect(() => splitLargestRemainder(100, [{ id: 'a', weight: 0 }])).toThrow();

    expect(() => formatIndianDigits('12a')).toThrow();
    expect(formatPaiseToInr(-50000, { showPaise: true })).toBe('-₹500.00');
    expect(() => formatPaiseToInr(12.34)).toThrow();

    expect(parseStrictIntegerRupeesToPaise(25)).toBe(2500);
    expect(() => parseStrictIntegerRupeesToPaise(0)).toThrow();
    expect(() => parseStrictIntegerRupeesToPaise(1.5)).toThrow();
    expect(() => parseStrictIntegerRupeesToPaise(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => parseStrictIntegerRupeesToPaise({} as unknown as string)).toThrow();
  });

  it('validates IST date helpers and month clamping', () => {
    expect(() => parseIstDateParts('2026-13-01')).toThrow();
    expect(() => parseIstDateParts('2026-02-30')).toThrow();
    expect(() => parseIstDateParts('not-a-date')).toThrow();
    expect(() => daysInMonth(2026, 0)).toThrow();
    expect(formatDisplayDate('2027-03-05', 'hi')).toBe('5 मार्च 2027');
    expect(addDaysIst('2026-10-31', 1)).toBe('2026-11-01');
    expect(addMonthsIst('2026-01-31', 1)).toBe('2026-02-28');
    expect(diffDaysIst('2026-10-10', '2026-11-01')).toBe(22);
  });

  it('covers loan interest across year wrap, implicit disbursement, rotation/share entries, and late rules', () => {
    const entries: CalcLedgerEntry[] = [
      {
        id: 'c1',
        memberId: 'm1',
        loanId: null,
        entryType: 'CONTRIBUTION',
        amountPaise: 100_000,
        effectiveDate: '2026-11-05',
      },
      {
        id: 'rp1',
        memberId: 'm1',
        loanId: null,
        entryType: 'ROTATION_PAYOUT',
        amountPaise: 50_000,
        effectiveDate: '2026-11-10',
      },
      {
        id: 'sp1',
        memberId: 'm1',
        loanId: null,
        entryType: 'SHARE_PAYOUT',
        amountPaise: 10_000,
        effectiveDate: '2026-12-31',
      },
      {
        id: 'l1-disb',
        memberId: 'm1',
        loanId: 'loan-wrap',
        entryType: 'LOAN_DISBURSEMENT',
        amountPaise: 100_000,
        effectiveDate: '2026-12-01',
      },
      {
        id: 'l1-acc',
        memberId: 'm1',
        loanId: 'loan-wrap',
        entryType: 'INTEREST_ACCRUAL',
        amountPaise: 3_000,
        effectiveDate: '2026-12-31',
      },
      {
        id: 'l1-ri',
        memberId: 'm1',
        loanId: 'loan-wrap',
        entryType: 'REPAYMENT_INTEREST',
        amountPaise: 1_000,
        effectiveDate: '2027-01-05',
      },
    ];

    const sav = calculateMemberSavings(entries, 'm1', '2026-12-31');
    expect(sav.totalContributedPaise).toBe(100_000);
    expect(sav.totalRotationReceivedPaise).toBe(50_000);
    expect(sav.totalSharePayoutPaise).toBe(10_000);

    // Implicit disbursement fallback when LOAN_DISBURSEMENT row is absent from entries
    const implicitOct = calculateLoanAccruedInterestForMonth({
      loanId: 'implicit-loan',
      disbursedDate: '2026-10-01',
      principalPaise: 100_000,
      interestRateBps: 300,
      interestMode: 'REDUCING_BALANCE',
      entries: [],
      year: 2026,
      month: 10,
    });
    expect(implicitOct).toBe(3_000);

    // Before loan disbursement month
    expect(
      calculateLoanAccruedInterestForMonth({
        loanId: 'implicit-loan',
        disbursedDate: '2026-10-15',
        principalPaise: 100_000,
        interestRateBps: 300,
        interestMode: 'REDUCING_BALANCE',
        entries: [],
        year: 2026,
        month: 9,
      })
    ).toBe(0);

    // Year wrap 2026-12 -> 2027-01 with includeAsOfDayInterest = true
    const balWrap = calculateLoanBalance({
      loanId: 'loan-wrap',
      disbursedDate: '2026-12-01',
      principalPaise: 100_000,
      interestRateBps: 300,
      interestMode: 'REDUCING_BALANCE',
      entries,
      asOfDate: '2027-01-31',
      includeAsOfDayInterest: true,
    });
    expect(balWrap.computedInterestAccruedPaise).toBe(6_000);
    expect(balWrap.unpaidAccruedInterestPaise).toBe(5_000);

    expect(() =>
      allocateRepayment({
        paymentAmountPaise: 0,
        outstandingPrincipalPaise: 1000,
        unpaidInterestPaise: 0,
      })
    ).toThrow();

    const settings: CycleSettings = {
      startDate: '2026-11-01',
      lengthMonths: 12,
      monthlyContributionPaise: 100_000,
      interestRateBps: 300,
      interestMode: 'REDUCING_BALANCE',
      interestSharingMode: 'PROPORTIONAL_CONTRIBUTION',
      rotationPayoutEnabled: true,
      lateRuleMode: 'FIXED_PAISA',
      lateRuleValue: 2500,
    };
    expect(calculateLateFee({ settings, expectedContributionPaise: 100_000, isLate: true })).toBe(
      2500
    );

    const totals = calculateGroupTotals({
      entries,
      settings,
      loans: [],
      asOfDate: '2027-01-31',
    });
    expect(totals.totalRotationPayoutsPaise).toBe(50_000);
    expect(totals.totalSharePayoutsPaise).toBe(10_000);

    // Sharing edge cases
    expect(
      calculateInterestShares({
        totalInterestPoolPaise: 0,
        members: [],
        sharingMode: 'EQUAL',
      })
    ).toEqual([]);
    expect(() =>
      calculateInterestShares({
        totalInterestPoolPaise: 100,
        members: [],
        sharingMode: 'EQUAL',
      })
    ).toThrow();
    expect(() =>
      calculateInterestShares({
        totalInterestPoolPaise: -1,
        members: [{ memberId: 'm1', totalContributedPaise: 100 }],
        sharingMode: 'EQUAL',
      })
    ).toThrow();
    expect(() =>
      calculateInterestShares({
        totalInterestPoolPaise: 100,
        members: [{ memberId: 'm1', totalContributedPaise: -1 }],
        sharingMode: 'PROPORTIONAL_CONTRIBUTION',
      })
    ).toThrow();
    expect(
      calculateInterestShares({
        totalInterestPoolPaise: 100,
        members: [
          { memberId: 'm1', totalContributedPaise: 0 },
          { memberId: 'm2', totalContributedPaise: 0 },
        ],
        sharingMode: 'PROPORTIONAL_CONTRIBUTION',
      })
    ).toEqual([
      { memberId: 'm1', sharePaise: 50 },
      { memberId: 'm2', sharePaise: 50 },
    ]);
  });
});
