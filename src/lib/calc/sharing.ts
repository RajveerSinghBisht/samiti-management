import { splitLargestRemainder } from '@/lib/money';
import type { InterestSharingMode } from './types';

/**
 * Splits `totalInterestPoolPaise` among members using the cycle's `sharingMode`
 * and Largest Remainder Method so member shares sum identically to the pool.
 */
export function calculateInterestShares(input: {
  totalInterestPoolPaise: number;
  members: ReadonlyArray<{ memberId: string; totalContributedPaise: number }>;
  sharingMode: InterestSharingMode;
}): Array<{ memberId: string; sharePaise: number }> {
  if (!Number.isSafeInteger(input.totalInterestPoolPaise) || input.totalInterestPoolPaise < 0) {
    throw new Error('totalInterestPoolPaise must be a non-negative safe integer');
  }
  if (input.members.length === 0) {
    if (input.totalInterestPoolPaise === 0) return [];
    throw new Error('Cannot distribute interest pool across zero members');
  }

  const allZeroContrib = input.members.every((m) => m.totalContributedPaise === 0);
  const useEqualWeights = input.sharingMode === 'EQUAL' || allZeroContrib;

  const weighted = input.members.map((m) => {
    if (!Number.isSafeInteger(m.totalContributedPaise) || m.totalContributedPaise < 0) {
      throw new Error('Member contribution must be a non-negative safe integer');
    }
    return {
      id: m.memberId,
      weight: useEqualWeights ? 1 : m.totalContributedPaise,
    };
  });

  const parts = splitLargestRemainder(input.totalInterestPoolPaise, weighted);
  return parts.map((p) => ({ memberId: p.id, sharePaise: p.amountPaise }));
}

