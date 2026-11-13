import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { makeJsonRequest, setupV2TestEnv } from './helpers';

/**
 * ACCEPTANCE V2: INFRASTRUCTURE A & B — REAL POSTGRESQL CONCURRENCY & TWO ROLES
 */
describe('Acceptance V2: Real PostgreSQL Concurrency & Two Roles', () => {
  const PG_HOST = process.env.PGHOST || '127.0.0.1';
  const PG_PORT = parseInt(process.env.PGPORT || '5432', 10);
  const PG_DATABASE = process.env.PGDATABASE || 'samiti_test';

  it('prohibits app role from updating or deleting ledger_entries at DB level', async () => {
    const appClient = new Client({
      host: PG_HOST,
      port: PG_PORT,
      database: PG_DATABASE,
      user: 'samiti_app',
      password: 'samiti_app_secret',
    });

    await appClient.connect();

    // 1. App role cannot DELETE from ledger_entries
    let deleteError: { code?: string } | null = null;
    try {
      await appClient.query('DELETE FROM ledger_entries WHERE id = $1', ['non-existent']);
    } catch (err) {
      deleteError = err as { code?: string };
    }
    expect(deleteError).not.toBeNull();
    expect(['42501', 'P0001']).toContain(deleteError?.code);

    // 2. App role cannot UPDATE ledger_entries
    let updateError: { code?: string } | null = null;
    try {
      await appClient.query('UPDATE ledger_entries SET amount_paise = 100 WHERE id = $1', ['non-existent']);
    } catch (err) {
      updateError = err as { code?: string };
    }
    expect(updateError).not.toBeNull();
    expect(['42501', 'P0001']).toContain(updateError?.code);

    await appClient.end();
  });

  it('handles real parallel database connections for concurrent operations', async () => {
    const { admin1, admin2 } = await setupV2TestEnv('real-postgres-concurrency');

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
          name: 'Concurrency Test Cycle',
          startDate: '2026-01-01',
          lengthMonths: 12,
          monthlyContributionPaise: 100_000,
          interestRateBps: 100,
          interestMode: 'REDUCING_BALANCE',
          interestSharingMode: 'EQUAL',
          normalLoanCapPaise: 10_000_000,
          emergencyLoanCapPaise: 20_000_000,
        },
      })
    );
    const { cycle } = await cycleRes.json();

    const memRes = await createMember(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { cycleId: cycle.id, name: 'Concurrent Borrower', mobile: '9877711111', initialSecret: '123456' },
      })
    );
    const { member } = await memRes.json();

    const loanRes = await requestLoanRoute(
      makeJsonRequest('/api/admin/loans', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId: cycle.id,
          memberId: member.id,
          principalPaise: 100_000,
          disbursedDate: '2026-01-10',
        },
      })
    );
    const { loan, approvalId } = await loanRes.json();

    // 1. Parallel double approval attempt by two admins
    const [appr1, appr2] = await Promise.all([
      decideApproval(
        makeJsonRequest(`/api/admin/approvals/${approvalId}/decide`, {
          method: 'POST',
          cookies: admin2.cookies,
          csrfToken: admin2.csrfToken,
          body: { decision: 'APPROVED' },
        }),
        { params: Promise.resolve({ id: approvalId }) }
      ),
      decideApproval(
        makeJsonRequest(`/api/admin/approvals/${approvalId}/decide`, {
          method: 'POST',
          cookies: admin2.cookies,
          csrfToken: admin2.csrfToken,
          body: { decision: 'APPROVED' },
        }),
        { params: Promise.resolve({ id: approvalId }) }
      ),
    ]);
    const apprStatuses = [appr1.status, appr2.status].sort();
    expect(apprStatuses).toEqual([200, 409]);

    // 2. Simultaneous repayments on one loan:
    const [rep1, rep2] = await Promise.all([
      repayLoanRoute(
        makeJsonRequest(`/api/admin/loans/${loan.id}/repay`, {
          method: 'POST',
          cookies: admin1.cookies,
          csrfToken: admin1.csrfToken,
          body: {
            principalPaidPaise: 60_000,
            interestPaidPaise: 0,
            effectiveDate: '2026-02-10',
          },
        }),
        { params: Promise.resolve({ id: loan.id }) }
      ),
      repayLoanRoute(
        makeJsonRequest(`/api/admin/loans/${loan.id}/repay`, {
          method: 'POST',
          cookies: admin1.cookies,
          csrfToken: admin1.csrfToken,
          body: {
            principalPaidPaise: 60_000,
            interestPaidPaise: 0,
            effectiveDate: '2026-02-10',
          },
        }),
        { params: Promise.resolve({ id: loan.id }) }
      ),
    ]);
    const repStatuses = [rep1.status, rep2.status].sort();
    expect(repStatuses).toEqual([201, 400]);
  });
});
