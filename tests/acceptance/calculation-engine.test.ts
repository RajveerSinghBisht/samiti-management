import { describe, expect, it } from 'vitest';
import {
  calculateGroupTotals,
  calculateInterestShares,
  calculateLateFee,
  calculateMemberSavings,
  calculateRotationSchedule,
  type CalcLedgerEntry,
  type CycleSettings,
} from '@/lib/calc';
import {
  formatPaiseToInr,
  parseStrictIntegerRupeesToPaise,
  parseStrictPaise,
  roundHalfUp,
  splitLargestRemainder,
} from '@/lib/money';
import { formatDisplayDate, getIstIsoWeekKey, toIstDateString } from '@/lib/dates';

describe('Calculation engine, money, rounding, and IST dates', () => {
  it('rounds half up strictly with BigInt integer math', () => {
    expect(roundHalfUp(1n, 2n)).toBe(1); // 0.5 -> 1
    expect(roundHalfUp(49n, 100n)).toBe(0); // 0.49 -> 0
    expect(roundHalfUp(5n, 2n)).toBe(3); // 2.5 -> 3
    expect(roundHalfUp(156_387_000n, 10_000n)).toBe(15_639); // 15638.7 -> 15639
    expect(roundHalfUp(6_600_000_000n, 310_000n)).toBe(21_290); // 21290.32 -> 21290
  });

  it('splits pools via largest remainder so shares always sum exactly to total', () => {
    const shares = splitLargestRemainder(10_000_000, [
      { id: 'm1', weight: 1 },
      { id: 'm2', weight: 1 },
      { id: 'm3', weight: 1 },
    ]);
    expect(shares.map((s) => s.amountPaise)).toEqual([3_333_334, 3_333_333, 3_333_333]);
    expect(shares.reduce((a, b) => a + b.amountPaise, 0)).toBe(10_000_000);

    // Single member
    const single = splitLargestRemainder(10_000_000, [{ id: 'm1', weight: 500_000 }]);
    expect(single).toEqual([{ id: 'm1', amountPaise: 10_000_000 }]);

    // Member with zero contributions under PROPORTIONAL_CONTRIBUTION receives 0
    const withZero = calculateInterestShares({
      totalInterestPoolPaise: 100_000,
      members: [
        { memberId: 'm1', totalContributedPaise: 300_000 },
        { memberId: 'm2', totalContributedPaise: 100_000 },
        { memberId: 'm3', totalContributedPaise: 0 },
      ],
      sharingMode: 'PROPORTIONAL_CONTRIBUTION',
    });
    expect(withZero).toEqual([
      { memberId: 'm1', sharePaise: 75_000 },
      { memberId: 'm2', sharePaise: 25_000 },
      { memberId: 'm3', sharePaise: 0 },
    ]);
  });

  it('formats Indian numbers, dates, and IST midnight boundaries accurately', () => {
    expect(formatPaiseToInr(12_345_600)).toBe('₹1,23,456');
    expect(formatPaiseToInr(12_345_650)).toBe('₹1,23,456.50');
    expect(formatPaiseToInr(100_000)).toBe('₹1,000');

    expect(formatDisplayDate('2027-03-05')).toBe('5 March 2027');

    // 2026-10-31 18:45:00 UTC == 2026-11-01 00:15:00 IST
    expect(toIstDateString(new Date('2026-10-31T18:45:00.000Z'))).toBe('2026-11-01');
    // 2026-10-31 18:29:59 UTC == 2026-10-31 23:59:59 IST
    expect(toIstDateString(new Date('2026-10-31T18:29:59.000Z'))).toBe('2026-10-31');

    // Sunday 2026-11-08 18:35 UTC == Monday 2026-11-09 00:05 IST (next ISO week!)
    const sunUtc = getIstIsoWeekKey(new Date('2026-11-08T18:35:00.000Z'));
    const monIst = getIstIsoWeekKey('2026-11-09');
    expect(sunUtc).toBe(monIst);
  });

  it('rejects non-integer, decimal, comma, exponent, zero, and negative amounts', () => {
    expect(parseStrictIntegerRupeesToPaise('1000')).toBe(100_000);
    expect(() => parseStrictIntegerRupeesToPaise('0')).toThrow();
    expect(() => parseStrictIntegerRupeesToPaise('-500')).toThrow();
    expect(() => parseStrictIntegerRupeesToPaise('100.50')).toThrow();
    expect(() => parseStrictIntegerRupeesToPaise('1,000')).toThrow();
    expect(() => parseStrictIntegerRupeesToPaise('1e4')).toThrow();

    expect(parseStrictPaise(500)).toBe(500);
    expect(() => parseStrictPaise(0)).toThrow();
    expect(() => parseStrictPaise(-1)).toThrow();
    expect(() => parseStrictPaise(10.5)).toThrow();
    expect(() => parseStrictPaise('1e3')).toThrow();
  });

  it('supports cycle settings for 1/2/5 year lengths, rotation schedule, late rules, and group totals reconciliation', () => {
    const settings: CycleSettings = {
      startDate: '2026-01-01',
      lengthMonths: 12,
      monthlyContributionPaise: 100_000,
      interestRateBps: 200,
      interestMode: 'REDUCING_BALANCE',
      interestSharingMode: 'PROPORTIONAL_CONTRIBUTION',
      rotationPayoutEnabled: true,
      lateRuleMode: 'PERCENT_BPS',
      lateRuleValue: 500, // 5%
    };

    const schedule = calculateRotationSchedule({
      settings,
      orderedMemberIds: ['m1', 'm2', 'm3'],
    });
    expect(schedule).toHaveLength(12);
    expect(schedule[0]).toEqual({
      monthIndex: 1,
      dueDate: '2026-01-01',
      recipientMemberId: 'm1',
      expectedPayoutPaise: 300_000,
    });
    expect(schedule[3]?.recipientMemberId).toBe('m1');

    const scheduleOff = calculateRotationSchedule({
      settings: { ...settings, rotationPayoutEnabled: false },
      orderedMemberIds: ['m1', 'm2', 'm3'],
    });
    expect(scheduleOff.every((s) => s.expectedPayoutPaise === 0 && s.recipientMemberId === null)).toBe(
      true
    );

    expect(calculateLateFee({ settings, expectedContributionPaise: 100_000, isLate: true })).toBe(5_000);
    expect(
      calculateLateFee({
        settings: { ...settings, lateRuleMode: 'NONE', lateRuleValue: 0 },
        expectedContributionPaise: 100_000,
        isLate: true,
      })
    ).toBe(0);

    const entries: CalcLedgerEntry[] = [
      { id: 'c1', memberId: 'm1', loanId: null, entryType: 'CONTRIBUTION', amountPaise: 100_000, effectiveDate: '2026-01-05' },
      { id: 'c2', memberId: 'm2', loanId: null, entryType: 'CONTRIBUTION', amountPaise: 100_000, effectiveDate: '2026-01-05' },
      { id: 'c3', memberId: 'm1', loanId: null, entryType: 'CONTRIBUTION', amountPaise: 100_000, effectiveDate: '2026-02-05' },
      // m2 skipped Feb
      { id: 'l1', memberId: 'm2', loanId: 'loan-1', entryType: 'LOAN_DISBURSEMENT', amountPaise: 150_000, effectiveDate: '2026-02-06' },
      { id: 'ri1', memberId: 'm2', loanId: 'loan-1', entryType: 'REPAYMENT_INTEREST', amountPaise: 3_000, effectiveDate: '2026-03-06' },
      { id: 'rp1', memberId: 'm2', loanId: 'loan-1', entryType: 'REPAYMENT_PRINCIPAL', amountPaise: 50_000, effectiveDate: '2026-03-06' },
    ];

    expect(calculateMemberSavings(entries, 'm1').totalContributedPaise).toBe(200_000);
    expect(calculateMemberSavings(entries, 'm2').totalContributedPaise).toBe(100_000);

    const totals = calculateGroupTotals({
      entries,
      settings,
      loans: [
        {
          id: 'loan-1',
          memberId: 'm2',
          disbursedDate: '2026-02-06',
          principalPaise: 150_000,
          interestRateBps: 200,
          interestMode: 'REDUCING_BALANCE',
        },
      ],
      asOfDate: '2026-03-06',
    });
    expect(totals.totalContributionsPaise).toBe(300_000);
    expect(totals.totalLoansDisbursedPaise).toBe(150_000);
    expect(totals.totalPrincipalRepaidPaise).toBe(50_000);
    expect(totals.totalOutstandingPrincipalPaise).toBe(100_000);
    expect(totals.totalInterestCollectedPaise).toBe(3_000);
    expect(totals.treasurerCashOnHandPaise).toBe(203_000); // 300k - 150k + 50k + 3k
    expect(totals.treasurerCashOnHandPaise + totals.totalOutstandingPrincipalPaise).toBe(
      totals.totalPoolEquityPaise
    );
  });
});

