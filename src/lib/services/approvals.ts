import { and, desc, eq } from 'drizzle-orm';
import {
  approvals,
  cycleMembers,
  cycles,
  getDb,
  loans,
  type AppDb,
} from '@/db';
import {
  calculateGroupTotals,
  calculateInterestShares,
  calculateLoanBalance,
  calculateMemberSavings,
  type LedgerEntryType,
} from '@/lib/calc';
import { toIstDateString } from '@/lib/dates';
import { recordAuditEvent } from './audit';
import { ServiceError } from './errors';
import { appendLedgerEntry, getCycleLedgerEntries, reverseLedgerEntry } from './ledger';

export async function listApprovals() {
  const db = getDb();
  return db.select().from(approvals).orderBy(desc(approvals.createdAt));
}

export async function decideApproval(input: {
  approvalId: string;
  decision: 'APPROVE' | 'REJECT';
  decisionReason?: string;
  adminId: string;
}) {
  const db = getDb();

  return db.transaction(async (tx: AppDb) => {
    const existingRows = await tx
      .select()
      .from(approvals)
      .where(eq(approvals.id, input.approvalId))
      .limit(1);

    const existing = existingRows.at(0);
    if (!existing) {
      throw new ServiceError(404, 'Approval request not found');
    }
    if (existing.requestedByAdminId === input.adminId) {
      throw new ServiceError(
        403,
        'Two-admin rule: a different admin must approve or reject this request'
      );
    }
    if (existing.status !== 'PENDING') {
      throw new ServiceError(409, 'Approval request has already been decided');
    }

    const nextStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const updatedRows = await tx
      .update(approvals)
      .set({
        status: nextStatus,
        decidedByAdminId: input.adminId,
        decisionReason: input.decisionReason?.trim() || null,
        decidedAt: new Date(),
      })
      .where(and(eq(approvals.id, input.approvalId), eq(approvals.status, 'PENDING')))
      .returning();

    const updatedApproval = updatedRows.at(0);
    if (!updatedApproval) {
      throw new ServiceError(409, 'Approval request has already been decided');
    }

    let sideEffectResult: Record<string, unknown> = {};

    if (input.decision === 'REJECT') {
      if (updatedApproval.actionType === 'LOAN_APPROVAL') {
        await tx
          .update(loans)
          .set({ status: 'REJECTED', approvedByAdminId: input.adminId })
          .where(eq(loans.id, updatedApproval.targetId));
      }
    } else {
      // APPROVE execution by actionType
      if (updatedApproval.actionType === 'LOAN_APPROVAL') {
        const loanRows = await tx
          .select()
          .from(loans)
          .where(eq(loans.id, updatedApproval.targetId))
          .limit(1);
        const loan = loanRows.at(0);
        if (!loan || loan.status !== 'PENDING_APPROVAL') {
          throw new ServiceError(409, 'Loan is not pending approval');
        }

        await tx
          .update(loans)
          .set({ status: 'ACTIVE', approvedByAdminId: input.adminId })
          .where(eq(loans.id, loan.id));

        const disbEntry = await appendLedgerEntry(
          {
            cycleId: loan.cycleId,
            memberId: loan.memberId,
            loanId: loan.id,
            entryType: 'LOAN_DISBURSEMENT',
            amountPaise: loan.principalPaise,
            effectiveDate: loan.disbursedDate,
            reason: loan.note || 'Approved loan disbursement',
            idempotencyKey: `loan-disb:${loan.id}`,
            createdByAdminId: input.adminId,
          },
          tx
        );
        sideEffectResult = { loanId: loan.id, ledgerEntryId: disbEntry.id };
      } else if (updatedApproval.actionType === 'HIGH_VALUE_REVERSAL') {
        const payload = updatedApproval.payloadJson as {
          ledgerEntryId: string;
          reason: string;
          replacement?: {
            entryType: Exclude<LedgerEntryType, 'REVERSAL'>;
            amountPaise: number;
            effectiveDate: string;
            monthIndex?: number | null;
          };
        };
        const rev = await reverseLedgerEntry(
          {
            ledgerEntryId: payload.ledgerEntryId,
            reason: payload.reason,
            adminId: input.adminId,
            replacement: payload.replacement,
          },
          tx
        );
        sideEffectResult = {
          reversalEntryId: rev.reversalEntry.id,
          replacementEntryId: rev.replacementEntry?.id ?? null,
        };
      } else if (updatedApproval.actionType === 'GOOD_CAUSE_GRANT') {
        const payload = updatedApproval.payloadJson as {
          cycleId: string;
          amountPaise: number;
          meetingDate: string;
          recipient: string;
          reason: string;
          consentNote: string;
        };
        const grantEntry = await appendLedgerEntry(
          {
            cycleId: payload.cycleId,
            memberId: null,
            loanId: null,
            entryType: 'GOOD_CAUSE_GRANT',
            amountPaise: payload.amountPaise,
            effectiveDate: payload.meetingDate,
            reason: `Good Cause Grant to ${payload.recipient}: ${payload.reason}`,
            idempotencyKey: `good-cause:${updatedApproval.id}`,
            createdByAdminId: input.adminId,
          },
          tx
        );
        sideEffectResult = { grantEntryId: grantEntry.id };
      } else if (updatedApproval.actionType === 'CYCLE_CLOSE') {
        const cycleRows = await tx
          .select()
          .from(cycles)
          .where(eq(cycles.id, updatedApproval.targetId))
          .limit(1);
        const cycle = cycleRows.at(0);
        if (!cycle || cycle.status !== 'ACTIVE') {
          throw new ServiceError(409, 'Cycle is not active');
        }

        const payload = updatedApproval.payloadJson as { asOfDate?: string };
        const asOfDate = payload.asOfDate || toIstDateString();
        const cycleLoans = await tx.select().from(loans).where(eq(loans.cycleId, cycle.id));
        const entries = await getCycleLedgerEntries(cycle.id, tx);

        for (const loan of cycleLoans) {
          if (loan.status === 'PENDING_APPROVAL') {
            throw new ServiceError(409, 'Pending loan approval blocks cycle close');
          }
          if (loan.status === 'ACTIVE') {
            const bal = calculateLoanBalance({
              loanId: loan.id,
              disbursedDate: loan.disbursedDate,
              principalPaise: loan.principalPaise,
              interestRateBps: loan.interestRateBps,
              interestMode: loan.interestMode,
              entries,
              asOfDate,
            });
            if (bal.outstandingPrincipalPaise > 0 || bal.unpaidAccruedInterestPaise > 0) {
              throw new ServiceError(409, 'Open loan balances block cycle close');
            }
          }
        }

        const totals = calculateGroupTotals({
          entries,
          settings: {
            startDate: cycle.startDate,
            lengthMonths: cycle.lengthMonths,
            monthlyContributionPaise: cycle.monthlyContributionPaise,
            interestRateBps: cycle.interestRateBps,
            interestMode: cycle.interestMode,
            interestSharingMode: cycle.interestSharingMode,
            rotationPayoutEnabled: cycle.rotationPayoutEnabled,
            lateRuleMode: cycle.lateRuleMode,
            lateRuleValue: cycle.lateRuleValue,
          },
          loans: cycleLoans.map((l) => ({
            id: l.id,
            memberId: l.memberId,
            disbursedDate: l.disbursedDate,
            principalPaise: l.principalPaise,
            interestRateBps: l.interestRateBps,
            interestMode: l.interestMode,
          })),
          asOfDate,
        });

        const enrolled = await tx
          .select()
          .from(cycleMembers)
          .where(eq(cycleMembers.cycleId, cycle.id));

        if (enrolled.length > 0 && totals.totalInterestCollectedPaise > 0) {
          const memberContribInputs = enrolled.map((cm) => ({
            memberId: cm.memberId,
            totalContributedPaise: calculateMemberSavings(entries, cm.memberId, asOfDate)
              .totalContributedPaise,
          }));
          const shares = calculateInterestShares({
            totalInterestPoolPaise: totals.totalInterestCollectedPaise,
            members: memberContribInputs,
            sharingMode: cycle.interestSharingMode,
          });
          for (const share of shares) {
            if (share.sharePaise > 0) {
              await appendLedgerEntry(
                {
                  cycleId: cycle.id,
                  memberId: share.memberId,
                  loanId: null,
                  entryType: 'SHARE_PAYOUT',
                  amountPaise: share.sharePaise,
                  effectiveDate: asOfDate,
                  reason: 'End-of-cycle interest share payout',
                  idempotencyKey: `cycle-share:${cycle.id}:${share.memberId}`,
                  createdByAdminId: input.adminId,
                },
                tx
              );
            }
          }
        }

        await tx
          .update(cycles)
          .set({ status: 'CLOSED', closedAt: new Date() })
          .where(eq(cycles.id, cycle.id));

        sideEffectResult = {
          cycleId: cycle.id,
          closedAt: asOfDate,
          distributedInterestPaise: totals.totalInterestCollectedPaise,
        };
      }
    }

    await recordAuditEvent(
      {
        actorMemberId: input.adminId,
        actorRole: 'ADMIN',
        action: `APPROVAL_${nextStatus}`,
        targetType: 'approval',
        targetId: updatedApproval.id,
        metadata: {
          actionType: updatedApproval.actionType,
          targetId: updatedApproval.targetId,
          ...sideEffectResult,
        },
      },
      tx
    );

    return {
      approval: updatedApproval,
      result: sideEffectResult,
    };
  });
}

