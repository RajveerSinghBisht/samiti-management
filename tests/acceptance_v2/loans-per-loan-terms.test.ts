import { describe, expect, it } from 'vitest';
import { makeJsonRequest, setupV2TestEnv } from './helpers';

/**
 * ACCEPTANCE V2: FEATURE 2 — LOANS WITH PER-LOAN TERMS & AUTHORITATIVE RULES
 */
describe('Acceptance V2: Loans with Per-Loan Terms & Authoritative Rules', () => {
  it('enforces per-loan terms, two-admin approval, repayment schedule updates, emergency cap limits, and human-supplied worked examples', async () => {
    const { admin1, admin2 } = await setupV2TestEnv('loans-per-loan-terms');

    const { POST: createCycle } = await import('@/app/api/admin/cycles/route');
    const { POST: createMember } = await import('@/app/api/admin/members/route');
    const { POST: requestLoanRoute } = await import('@/app/api/admin/loans/route');
    const { POST: decideApproval } = await import('@/app/api/admin/approvals/[id]/decide/route');
    const { POST: repayLoanRoute } = await import('@/app/api/admin/loans/[id]/repay/route');

    const cycleRes = await createCycle(
      makeJsonRequest('/api/admin/cycles', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          name: 'Authoritative Rules 2026 Cycle',
          startDate: '2026-01-01',
          lengthMonths: 12,
          monthlyContributionPaise: 100_000, // Rs 1,000
          interestRateBps: 100, // 1% per month default
          interestMode: 'REDUCING_BALANCE',
          interestSharingMode: 'EQUAL',
          normalLoanCapPaise: 2_000_000, // Rs 20,000 normal cap
          emergencyLoanCapPaise: 5_000_000, // Rs 50,000 emergency cap
        },
      })
    );
    const { cycle } = await cycleRes.json();

    // Create Member A (Ramesh)
    const memRes = await createMember(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId: cycle.id,
          name: 'Ramesh Patel',
          mobile: '9833311111',
          initialSecret: '123456',
        },
      })
    );
    const { member } = await memRes.json();

    // 1. Create loan with per-loan terms: MONTHLY_INSTALLMENTS (term 10 months)
    const loanReqRes = await requestLoanRoute(
      makeJsonRequest('/api/admin/loans', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId: cycle.id,
          memberId: member.id,
          principalPaise: 2_000_000, // Rs 20,000 (at normal cap)
          interestRateBps: 100, // 1% per month
          repaymentMode: 'MONTHLY_INSTALLMENTS',
          termMonths: 10,
          disbursedDate: '2026-01-10',
          note: 'Agricultural tools loan',
        },
      })
    );
    expect(loanReqRes.status).toBe(201);
    const { loan, approvalId } = await loanReqRes.json();
    expect(loan.repaymentMode).toBe('MONTHLY_INSTALLMENTS');
    expect(loan.termMonths).toBe(10);
    expect(loan.status).toBe('PENDING_APPROVAL');

    // 2. Second admin approves the loan
    const approveRes = await decideApproval(
      makeJsonRequest(`/api/admin/approvals/${approvalId}/decide`, {
        method: 'POST',
        cookies: admin2.cookies,
        csrfToken: admin2.csrfToken,
        body: { decision: 'APPROVED' },
      }),
      { params: Promise.resolve({ id: approvalId }) }
    );
    expect(approveRes.status).toBe(200);

    // 3. Emergency cap check:
    const nonEmergencyReq = await requestLoanRoute(
      makeJsonRequest('/api/admin/loans', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId: cycle.id,
          memberId: member.id,
          principalPaise: 1_000_000, // Rs 10,000
          disbursedDate: '2026-01-10',
          isEmergency: false,
        },
      })
    );
    expect(nonEmergencyReq.status).toBe(400);

    const emergencyReq = await requestLoanRoute(
      makeJsonRequest('/api/admin/loans', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId: cycle.id,
          memberId: member.id,
          principalPaise: 1_000_000, // Rs 10,000
          disbursedDate: '2026-01-10',
          isEmergency: true,
          emergencyReason: 'Medical hospitalisation in family',
        },
      })
    );
    expect(emergencyReq.status).toBe(201);

    const overEmergencyReq = await requestLoanRoute(
      makeJsonRequest('/api/admin/loans', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId: cycle.id,
          memberId: member.id,
          principalPaise: 6_000_000, // Rs 60,000 > Rs 50,000 emergency cap
          disbursedDate: '2026-01-10',
          isEmergency: true,
          emergencyReason: 'House renovation',
        },
      })
    );
    expect(overEmergencyReq.status).toBe(400);

    // 4. February meeting repayment: A pays Rs 200 interest and repays Rs 5,000 principal
    const febRepayRes = await repayLoanRoute(
      makeJsonRequest(`/api/admin/loans/${loan.id}/repay`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          interestPaidPaise: 20_000, // Rs 200 interest
          principalPaidPaise: 500_000, // Rs 5,000 principal
          effectiveDate: '2026-02-10',
        },
      }),
      { params: Promise.resolve({ id: loan.id }) }
    );
    expect(febRepayRes.status).toBe(201);
    const { loan: updatedLoan } = await febRepayRes.json();
    expect(updatedLoan.outstandingPrincipalPaise).toBe(1_500_000); // Rs 15,000
    expect(updatedLoan.nextDueDate).toBe('2026-03-10');
  });
});
