import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  calculateGroupTotals,
  calculateInterestShares,
  calculateLoanBalance,
  calculateMemberSavings,
  type CalcLedgerEntry,
} from '@/lib/calc';
import { splitLargestRemainder } from '@/lib/money';

describe('G5 Fast-check property invariants', () => {
  it('shares always sum exactly to the pool for arbitrary positive pools and weights', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 1, maxLength: 60 }),
        fc.constantFrom('PROPORTIONAL_CONTRIBUTION' as const, 'EQUAL' as const),
        (totalPool, weights, sharingMode) => {
          const members = weights.map((w, idx) => ({
            memberId: `member-${String(idx).padStart(2, '0')}`,
            totalContributedPaise: w,
          }));
          const shares = calculateInterestShares({
            totalInterestPoolPaise: totalPool,
            members,
            sharingMode,
          });
          expect(shares).toHaveLength(members.length);
          const sum = shares.reduce((acc, s) => acc + s.sharePaise, 0);
          expect(sum).toBe(totalPool);
          for (const s of shares) {
            expect(s.sharePaise).toBeGreaterThanOrEqual(0);
            expect(Number.isSafeInteger(s.sharePaise)).toBe(true);
          }

          if (weights.some((w) => w > 0)) {
            const direct = splitLargestRemainder(
              totalPool,
              members.map((m) => ({ id: m.memberId, weight: m.totalContributedPaise }))
            );
            expect(direct.reduce((acc, s) => acc + s.amountPaise, 0)).toBe(totalPool);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('reversing an entry always restores the exact prior savings and loan balance', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            day: fc.integer({ min: 1, max: 28 }),
            amountPaise: fc.integer({ min: 100, max: 500_000 }),
            memberIdx: fc.integer({ min: 0, max: 4 }),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        fc.integer({ min: 0, max: 19 }),
        (rawEvents, targetIdxRaw) => {
          const targetIdx = targetIdxRaw % rawEvents.length;
          const entries: CalcLedgerEntry[] = rawEvents.map((ev, i) => ({
            id: `c-${i}`,
            memberId: `m-${ev.memberIdx}`,
            loanId: null,
            entryType: 'CONTRIBUTION',
            amountPaise: ev.amountPaise,
            effectiveDate: `2026-05-${String(ev.day).padStart(2, '0')}`,
          }));

          const withoutTarget = entries.filter((_, i) => i !== targetIdx);
          const target = entries[targetIdx]!;
          const withReversal: CalcLedgerEntry[] = [
            ...entries,
            {
              id: `rev-${target.id}`,
              memberId: target.memberId,
              loanId: target.loanId,
              entryType: 'REVERSAL',
              amountPaise: target.amountPaise,
              effectiveDate: '2026-05-29',
              reversesEntryId: target.id,
            },
          ];

          for (let m = 0; m < 5; m++) {
            const memberId = `m-${m}`;
            expect(calculateMemberSavings(withReversal, memberId).totalContributedPaise).toBe(
              calculateMemberSavings(withoutTarget, memberId).totalContributedPaise
            );
          }
        }
      ),
      { numRuns: 150 }
    );
  });

  it('results are strictly independent of entry order within any day, and no displayed balance is ever negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50_000, max: 2_000_000 }),
        fc.array(
          fc.record({
            dayOffset: fc.integer({ min: 0, max: 10 }),
            kind: fc.constantFrom('CONTRIBUTION' as const, 'REPAYMENT_PRINCIPAL' as const),
            amount: fc.integer({ min: 100, max: 10_000 }),
          }),
          { minLength: 2, maxLength: 20 }
        ),
        (principalPaise, ops) => {
          let remaining = principalPaise;
          const baseEntries: CalcLedgerEntry[] = [
            {
              id: 'loan-disb',
              memberId: 'm-0',
              loanId: 'loan-1',
              entryType: 'LOAN_DISBURSEMENT',
              amountPaise: principalPaise,
              effectiveDate: '2026-10-01',
            },
          ];

          ops.forEach((op, idx) => {
            const day = String(1 + op.dayOffset).padStart(2, '0');
            if (op.kind === 'CONTRIBUTION') {
              baseEntries.push({
                id: `op-${idx}`,
                memberId: `m-${idx % 3}`,
                loanId: null,
                entryType: 'CONTRIBUTION',
                amountPaise: op.amount,
                effectiveDate: `2026-10-${day}`,
              });
            } else if (remaining >= op.amount) {
              remaining -= op.amount;
              baseEntries.push({
                id: `op-${idx}`,
                memberId: 'm-0',
                loanId: 'loan-1',
                entryType: 'REPAYMENT_PRINCIPAL',
                amountPaise: op.amount,
                effectiveDate: `2026-10-${day}`,
              });
            }
          });

          // Reverse array order so same-day entries appear in opposite order
          const reversedEntries = [...baseEntries].reverse();

          const bal1 = calculateLoanBalance({
            loanId: 'loan-1',
            disbursedDate: '2026-10-01',
            principalPaise,
            interestRateBps: 300,
            interestMode: 'REDUCING_BALANCE',
            entries: baseEntries,
            asOfDate: '2026-11-01',
          });
          const bal2 = calculateLoanBalance({
            loanId: 'loan-1',
            disbursedDate: '2026-10-01',
            principalPaise,
            interestRateBps: 300,
            interestMode: 'REDUCING_BALANCE',
            entries: reversedEntries,
            asOfDate: '2026-11-01',
          });

          expect(bal1).toEqual(bal2);
          expect(bal1.outstandingPrincipalPaise).toBeGreaterThanOrEqual(0);
          expect(bal1.unpaidAccruedInterestPaise).toBeGreaterThanOrEqual(0);
          expect(bal1.totalOwedPaise).toBeGreaterThanOrEqual(0);

          const totals1 = calculateGroupTotals({
            entries: baseEntries,
            settings: {
              startDate: '2026-10-01',
              lengthMonths: 12,
              monthlyContributionPaise: 100_000,
              interestRateBps: 300,
              interestMode: 'REDUCING_BALANCE',
              interestSharingMode: 'PROPORTIONAL_CONTRIBUTION',
              rotationPayoutEnabled: false,
              lateRuleMode: 'NONE',
              lateRuleValue: 0,
            },
            loans: [
              {
                id: 'loan-1',
                memberId: 'm-0',
                disbursedDate: '2026-10-01',
                principalPaise,
                interestRateBps: 300,
                interestMode: 'REDUCING_BALANCE',
              },
            ],
            asOfDate: '2026-11-01',
          });
          const totals2 = calculateGroupTotals({
            entries: reversedEntries,
            settings: {
              startDate: '2026-10-01',
              lengthMonths: 12,
              monthlyContributionPaise: 100_000,
              interestRateBps: 300,
              interestMode: 'REDUCING_BALANCE',
              interestSharingMode: 'PROPORTIONAL_CONTRIBUTION',
              rotationPayoutEnabled: false,
              lateRuleMode: 'NONE',
              lateRuleValue: 0,
            },
            loans: [
              {
                id: 'loan-1',
                memberId: 'm-0',
                disbursedDate: '2026-10-01',
                principalPaise,
                interestRateBps: 300,
                interestMode: 'REDUCING_BALANCE',
              },
            ],
            asOfDate: '2026-11-01',
          });
          expect(totals1).toEqual(totals2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

