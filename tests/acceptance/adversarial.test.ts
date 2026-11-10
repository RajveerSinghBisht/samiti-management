import { afterEach, describe, expect, it } from 'vitest';
import {
  createIsolatedTestDb,
  loginAdminWithTotpSetup,
  makeJsonRequest,
  rawExecuteSql,
  type TestDbHandle,
} from './helpers';
import { parseEnv } from '@/lib/env';

describe('Adversarial scenarios', () => {
  let dbHandle: TestDbHandle | null = null;

  afterEach(async () => {
    if (dbHandle) {
      await dbHandle.cleanup();
      dbHandle = null;
    }
  });

  it('G10 env validation fails fast when required variables are missing', () => {
    expect(() => parseEnv({})).toThrow();
    expect(() =>
      parseEnv({
        DATABASE_URL: 'pglite://memory',
        SESSION_SECRET: 'too-short',
        PIN_PEPPER: 'valid-pepper-length-16',
        TOTP_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        CRON_SECRET: 'valid-cron-secret-16',
      })
    ).toThrow();
  });

  it('rejects overpayment, invalid numeric formats, double reversal, missing reversal, concurrent overpayment, cycle close with open loan, and safely stores XSS/SQLi strings', async () => {
    dbHandle = await createIsolatedTestDb('adversarial');

    const admin1 = await loginAdminWithTotpSetup({
      name: 'Admin One',
      mobile: '9999900001',
      password: 'VeryStrongAdminPassword#123',
    });

    const { POST: createMemberRoute } = await import('@/app/api/admin/members/route');
    await createMemberRoute(
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
    const admin2 = await loginAdminWithTotpSetup({
      name: 'Admin Two',
      mobile: '9999900002',
      password: 'SecondStrongAdminPass#456',
      alreadySeeded: true,
    });

    // XSS & SQL injection strings in member name
    const xssSqlName = `<script>alert("xss")</script>'; DROP TABLE ledger_entries; --`;
    const memRes = await createMemberRoute(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { name: xssSqlName, mobile: '9876509999', role: 'MEMBER', initialSecret: '4321' },
      })
    );
    expect(memRes.status).toBe(201);
    const memberId = ((await memRes.json()) as { member: { id: string } }).member.id;

    // Confirm ledger_entries table still exists!
    await expect(
      rawExecuteSql(dbHandle.databaseUrl, 'SELECT COUNT(*) FROM ledger_entries')
    ).resolves.toBeDefined();

    // Create cycle
    const { POST: createCycleRoute } = await import('@/app/api/admin/cycles/route');
    const cycleId = (
      (await (
        await createCycleRoute(
          makeJsonRequest('/api/admin/cycles', {
            method: 'POST',
            cookies: admin1.cookies,
            csrfToken: admin1.csrfToken,
            body: {
              name: 'Adversarial Cycle',
              startDate: '2026-01-01',
              lengthMonths: 12,
              monthlyContributionPaise: 100_000,
              interestRateBps: 300,
              interestMode: 'REDUCING_BALANCE',
              interestSharingMode: 'PROPORTIONAL_CONTRIBUTION',
              rotationPayoutEnabled: false,
            },
          })
        )
      ).json()) as { cycle: { id: string } }
    ).cycle.id;

    // Invalid amounts (zero, negative, float, comma string, exponent string) on contributions
    const { POST: recordContrib } = await import('@/app/api/admin/contributions/route');
    for (const badAmount of [0, -100, 100.5, '1,000', '1e4']) {
      const badRes = await recordContrib(
        makeJsonRequest('/api/admin/contributions', {
          method: 'POST',
          cookies: admin1.cookies,
          csrfToken: admin1.csrfToken,
          body: {
            cycleId,
            memberId,
            monthIndex: 1,
            amountPaise: badAmount,
            effectiveDate: '2026-01-05',
          },
        })
      );
      expect(badRes.status).toBe(400);
    }

    // Valid contribution of Rs 500 (50,000 paise, below reversal approval threshold 100,000)
    const goodContrib = await recordContrib(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId,
          memberId,
          monthIndex: 1,
          amountPaise: 50_000,
          effectiveDate: '2026-01-05',
        },
      })
    );
    expect(goodContrib.status).toBe(201);
    const contribId = ((await goodContrib.json()) as { entry: { id: string } }).entry.id;

    // Reversal of missing entry -> 404
    const { POST: reverseRoute } = await import('@/app/api/admin/ledger/reverse/route');
    const missingRev = await reverseRoute(
      makeJsonRequest('/api/admin/ledger/reverse', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          ledgerEntryId: '00000000-0000-4000-8000-000000000000',
          reason: 'Missing check',
        },
      })
    );
    expect(missingRev.status).toBe(404);

    // Reversal of valid entry -> 201, second reversal of same entry -> 409!
    const firstRev = await reverseRoute(
      makeJsonRequest('/api/admin/ledger/reverse', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { ledgerEntryId: contribId, reason: 'First reversal' },
      })
    );
    expect(firstRev.status).toBe(201);

    const secondRev = await reverseRoute(
      makeJsonRequest('/api/admin/ledger/reverse', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { ledgerEntryId: contribId, reason: 'Double reversal attempt' },
      })
    );
    expect(secondRev.status).toBe(409);

    // Record fresh contribution so cash pool has Rs 2,000
    await recordContrib(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId,
          memberId,
          monthIndex: 2,
          amountPaise: 200_000,
          effectiveDate: '2026-02-05',
        },
      })
    );

    // Loan taken in last month (Dec 2026) -> allowed, then closing cycle with open loan -> blocked (409)
    const { POST: requestLoan } = await import('@/app/api/admin/loans/route');
    const loanRes = (await (
      await requestLoan(
        makeJsonRequest('/api/admin/loans', {
          method: 'POST',
          cookies: admin1.cookies,
          csrfToken: admin1.csrfToken,
          body: { cycleId, memberId, principalPaise: 100_000, disbursedDate: '2026-12-10' },
        })
      )
    ).json()) as { loan: { id: string }; approval: { id: string } };

    const { POST: decideApproval } = await import('@/app/api/admin/approvals/[id]/decide/route');
    await decideApproval(
      makeJsonRequest(`/api/admin/approvals/${loanRes.approval.id}/decide`, {
        method: 'POST',
        cookies: admin2.cookies,
        csrfToken: admin2.csrfToken,
        body: { decision: 'APPROVE' },
      }),
      { params: Promise.resolve({ id: loanRes.approval.id }) }
    );

    const { POST: closeCycleRoute } = await import('@/app/api/admin/cycles/[id]/close/route');
    const blockedClose = await closeCycleRoute(
      makeJsonRequest(`/api/admin/cycles/${cycleId}/close`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { asOfDate: '2026-12-31', reason: 'Attempt close with open loan' },
      }),
      { params: Promise.resolve({ id: cycleId }) }
    );
    expect(blockedClose.status).toBe(409);

    // Repayment larger than owed -> 400
    const { POST: repayLoan } = await import('@/app/api/admin/loans/[id]/repay/route');
    const overRepay = await repayLoan(
      makeJsonRequest(`/api/admin/loans/${loanRes.loan.id}/repay`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { amountPaise: 200_000, effectiveDate: '2026-12-10' },
      }),
      { params: Promise.resolve({ id: loanRes.loan.id }) }
    );
    expect(overRepay.status).toBe(400);

    // Concurrent repayments of Rs 600 + Rs 600 on Rs 1,000 loan -> only ONE succeeds, never negative balance!
    const [r1, r2] = await Promise.all([
      repayLoan(
        makeJsonRequest(`/api/admin/loans/${loanRes.loan.id}/repay`, {
          method: 'POST',
          cookies: admin1.cookies,
          csrfToken: admin1.csrfToken,
          body: { amountPaise: 60_000, effectiveDate: '2026-12-10' },
        }),
        { params: Promise.resolve({ id: loanRes.loan.id }) }
      ),
      repayLoan(
        makeJsonRequest(`/api/admin/loans/${loanRes.loan.id}/repay`, {
          method: 'POST',
          cookies: admin1.cookies,
          csrfToken: admin1.csrfToken,
          body: { amountPaise: 60_000, effectiveDate: '2026-12-10' },
        }),
        { params: Promise.resolve({ id: loanRes.loan.id }) }
      ),
    ]);
    const repayStatuses = [r1.status, r2.status].sort();
    expect(repayStatuses).toEqual([201, 400]);

    // Meeting place with SQLi/XSS string works safely
    const { POST: createMeeting } = await import('@/app/api/admin/meetings/route');
    const meetRes = await createMeeting(
      makeJsonRequest('/api/admin/meetings', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId,
          meetingDate: '2026-12-20',
          place: `<img src=x onerror=alert(1)> House 12, Sector 4'; DELETE FROM meetings;--`,
        },
      })
    );
    expect(meetRes.status).toBe(201);
  });
});

