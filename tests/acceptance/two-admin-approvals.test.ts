import { afterEach, describe, expect, it } from 'vitest';
import {
  createIsolatedTestDb,
  loginAdminWithTotpSetup,
  makeJsonRequest,
  type TestDbHandle,
} from './helpers';
import { getCycleLedgerEntries } from '@/lib/services/ledger';

describe('Two-admin approval rule (loan approval, cycle close, high-value reversal)', () => {
  let dbHandle: TestDbHandle | null = null;

  afterEach(async () => {
    if (dbHandle) {
      await dbHandle.cleanup();
      dbHandle = null;
    }
  });

  it('enforces second-admin approval on loans, cycle close, and high-value reversals and prevents concurrent double approval', async () => {
    dbHandle = await createIsolatedTestDb('two-admin');

    const admin1 = await loginAdminWithTotpSetup({
      name: 'Admin One',
      mobile: '9999900001',
      password: 'VeryStrongAdminPassword#123',
    });

    const { POST: createMemberRoute } = await import('@/app/api/admin/members/route');
    const createAdmin2Res = await createMemberRoute(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          name: 'Admin Two',
          mobile: '9999900002',
          role: 'ADMIN',
          initialSecret: 'SecondStrongAdminPass#456',
        },
      })
    );
    expect(createAdmin2Res.status).toBe(201);

    const admin2 = await loginAdminWithTotpSetup({
      name: 'Admin Two',
      mobile: '9999900002',
      password: 'SecondStrongAdminPass#456',
      alreadySeeded: true,
    });

    const createMemRes = await createMemberRoute(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          name: 'Mohan Lal',
          mobile: '9876500011',
          role: 'MEMBER',
          initialSecret: '2468',
        },
      })
    );
    const memberId = ((await createMemRes.json()) as { member: { id: string } }).member.id;

    // Create cycle
    const { POST: createCycleRoute } = await import('@/app/api/admin/cycles/route');
    const cycleRes = await createCycleRoute(
      makeJsonRequest('/api/admin/cycles', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          name: 'Samiti 2026',
          startDate: '2026-01-01',
          lengthMonths: 12,
          monthlyContributionPaise: 100_000,
          interestRateBps: 300,
          interestMode: 'REDUCING_BALANCE',
          interestSharingMode: 'PROPORTIONAL_CONTRIBUTION',
          rotationPayoutEnabled: false,
        },
      })
    );
    expect(cycleRes.status).toBe(201);
    const cycleId = ((await cycleRes.json()) as { cycle: { id: string } }).cycle.id;

    // Record contribution of Rs 20,000 (2,000,000 paise) above reversal threshold (100,000 paise)
    const { POST: recordContribution } = await import('@/app/api/admin/contributions/route');
    const contribRes = await recordContribution(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId,
          memberId,
          monthIndex: 1,
          amountPaise: 200_000,
          effectiveDate: '2026-01-05',
        },
      })
    );
    expect(contribRes.status).toBe(201);
    const contribEntryId = ((await contribRes.json()) as { entry: { id: string } }).entry.id;

    // Admin 1 requests a loan -> PENDING_APPROVAL, no disbursement in ledger yet
    const { POST: requestLoan } = await import('@/app/api/admin/loans/route');
    const loanRes = await requestLoan(
      makeJsonRequest('/api/admin/loans', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId,
          memberId,
          principalPaise: 150_000,
          disbursedDate: '2026-01-10',
          note: 'Medical expense',
        },
      })
    );
    expect(loanRes.status).toBe(201);
    const loanBody = (await loanRes.json()) as {
      loan: { id: string; status: string };
      approval: { id: string };
    };
    expect(loanBody.loan.status).toBe('PENDING_APPROVAL');
    expect(
      (await getCycleLedgerEntries(cycleId)).filter((e) => e.entryType === 'LOAN_DISBURSEMENT')
    ).toHaveLength(0);

    // Admin 1 tries to approve own loan request -> 403 Forbidden!
    const { POST: decideApproval } = await import('@/app/api/admin/approvals/[id]/decide/route');
    const selfApprove = await decideApproval(
      makeJsonRequest(`/api/admin/approvals/${loanBody.approval.id}/decide`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { decision: 'APPROVE' },
      }),
      { params: Promise.resolve({ id: loanBody.approval.id }) }
    );
    expect(selfApprove.status).toBe(403);

    // Concurrent double approval by Admin 2 -> exactly ONE succeeds (200), other gets 409 Conflict!
    const [approveA, approveB] = await Promise.all([
      decideApproval(
        makeJsonRequest(`/api/admin/approvals/${loanBody.approval.id}/decide`, {
          method: 'POST',
          cookies: admin2.cookies,
          csrfToken: admin2.csrfToken,
          body: { decision: 'APPROVE' },
        }),
        { params: Promise.resolve({ id: loanBody.approval.id }) }
      ),
      decideApproval(
        makeJsonRequest(`/api/admin/approvals/${loanBody.approval.id}/decide`, {
          method: 'POST',
          cookies: admin2.cookies,
          csrfToken: admin2.csrfToken,
          body: { decision: 'APPROVE' },
        }),
        { params: Promise.resolve({ id: loanBody.approval.id }) }
      ),
    ]);
    const statuses = [approveA.status, approveB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const disbursements = (await getCycleLedgerEntries(cycleId)).filter(
      (e) => e.entryType === 'LOAN_DISBURSEMENT'
    );
    expect(disbursements).toHaveLength(1);

    // High-value reversal (> 100,000 threshold) requires second admin approval
    const { POST: reverseRoute } = await import('@/app/api/admin/ledger/reverse/route');
    const highRevReq = await reverseRoute(
      makeJsonRequest('/api/admin/ledger/reverse', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          ledgerEntryId: contribEntryId,
          reason: 'Typo in contribution amount',
        },
      })
    );
    expect(highRevReq.status).toBe(201);
    const highRevBody = (await highRevReq.json()) as {
      status: string;
      approval: { id: string };
    };
    expect(highRevBody.status).toBe('PENDING_APPROVAL');

    // Admin 1 cannot approve their own high-value reversal
    const selfRevApprove = await decideApproval(
      makeJsonRequest(`/api/admin/approvals/${highRevBody.approval.id}/decide`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { decision: 'APPROVE' },
      }),
      { params: Promise.resolve({ id: highRevBody.approval.id }) }
    );
    expect(selfRevApprove.status).toBe(403);

    // Admin 2 approves high-value reversal -> REVERSAL entry created
    const admin2RevApprove = await decideApproval(
      makeJsonRequest(`/api/admin/approvals/${highRevBody.approval.id}/decide`, {
        method: 'POST',
        cookies: admin2.cookies,
        csrfToken: admin2.csrfToken,
        body: { decision: 'APPROVE' },
      }),
      { params: Promise.resolve({ id: highRevBody.approval.id }) }
    );
    expect(admin2RevApprove.status).toBe(200);
    expect(
      (await getCycleLedgerEntries(cycleId)).filter((e) => e.entryType === 'REVERSAL')
    ).toHaveLength(1);

    // Repay loan completely so cycle can close
    const { POST: repayLoan } = await import('@/app/api/admin/loans/[id]/repay/route');
    const repayRes = await repayLoan(
      makeJsonRequest(`/api/admin/loans/${loanBody.loan.id}/repay`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          amountPaise: 150_000,
          effectiveDate: '2026-01-10',
        },
      }),
      { params: Promise.resolve({ id: loanBody.loan.id }) }
    );
    expect(repayRes.status).toBe(201);

    // Cycle close requires second admin approval
    const { POST: closeCycleRoute } = await import('@/app/api/admin/cycles/[id]/close/route');
    const closeReq = await closeCycleRoute(
      makeJsonRequest(`/api/admin/cycles/${cycleId}/close`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { asOfDate: '2026-12-31', reason: 'End of 1-year cycle' },
      }),
      { params: Promise.resolve({ id: cycleId }) }
    );
    expect(closeReq.status).toBe(201);
    const closeBody = (await closeReq.json()) as { approval: { id: string } };

    // Admin 1 cannot self-approve cycle close
    const selfClose = await decideApproval(
      makeJsonRequest(`/api/admin/approvals/${closeBody.approval.id}/decide`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { decision: 'APPROVE' },
      }),
      { params: Promise.resolve({ id: closeBody.approval.id }) }
    );
    expect(selfClose.status).toBe(403);

    // Admin 2 approves cycle close
    const approvedClose = await decideApproval(
      makeJsonRequest(`/api/admin/approvals/${closeBody.approval.id}/decide`, {
        method: 'POST',
        cookies: admin2.cookies,
        csrfToken: admin2.csrfToken,
        body: { decision: 'APPROVE' },
      }),
      { params: Promise.resolve({ id: closeBody.approval.id }) }
    );
    expect(approvedClose.status).toBe(200);
  });
});

