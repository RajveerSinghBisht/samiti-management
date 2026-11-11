import { addMonthsIst } from '@/lib/dates';
import { roundHalfUp } from '@/lib/money';
import type { CycleSettings } from './types';

/**
 * Computes the monthly rotation payout schedule for months 1..settings.lengthMonths.
 */
export function calculateRotationSchedule(input: {
  settings: CycleSettings;
  orderedMemberIds: ReadonlyArray<string>;
}): Array<{
  monthIndex: number;
  dueDate: string;
  recipientMemberId: string | null;
  expectedPayoutPaise: number;
}> {
  const schedule: Array<{
    monthIndex: number;
    dueDate: string;
    recipientMemberId: string | null;
    expectedPayoutPaise: number;
  }> = [];

  for (let monthIndex = 1; monthIndex <= input.settings.lengthMonths; monthIndex++) {
    const dueDate = addMonthsIst(input.settings.startDate, monthIndex - 1);
    if (!input.settings.rotationPayoutEnabled || input.orderedMemberIds.length === 0) {
      schedule.push({
        monthIndex,
        dueDate,
        recipientMemberId: null,
        expectedPayoutPaise: 0,
      });
      continue;
    }

    const idx = (monthIndex - 1) % input.orderedMemberIds.length;
    const recipientMemberId = input.orderedMemberIds.at(idx) ?? null;
    const expectedPayoutPaise =
      input.settings.monthlyContributionPaise * input.orderedMemberIds.length;

    schedule.push({
      monthIndex,
      dueDate,
      recipientMemberId,
      expectedPayoutPaise,
    });
  }

  return schedule;
}

/**
 * Computes late contribution fee based on cycle settings (`NONE` by default).
 */
export function calculateLateFee(input: {
  settings: CycleSettings;
  expectedContributionPaise: number;
  isLate: boolean;
}): number {
  if (!input.isLate || input.settings.lateRuleMode === 'NONE') {
    return 0;
  }
  if (input.settings.lateRuleMode === 'FIXED_PAISA') {
    return input.settings.lateRuleValue;
  }
  return roundHalfUp(
    BigInt(input.expectedContributionPaise) * BigInt(input.settings.lateRuleValue),
    10_000n
  );
}

