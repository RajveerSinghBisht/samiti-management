import { afterEach, describe, expect, it } from 'vitest';
import {
  createIsolatedTestDb,
  loginAdminWithTotpSetup,
  makeJsonRequest,
  type TestDbHandle,
} from './helpers';
import { exportAllData, restoreFromExportJson } from '@/lib/services/export-restore';
import { getCycleLedgerEntries } from '@/lib/services/ledger';
import { calculateGroupTotals, calculateMemberSavings } from '@/lib/calc';

describe('G11 Weekly cron idempotency and Export-then-Restore backup fidelity', () => {
  let dbHandle: TestDbHandle | null = null;
  let restoreDbHandle: TestDbHandle | null = null;

  afterEach(async () => {
    if (dbHandle) {
      await dbHandle.cleanup();
      dbHandle = null;
    }
    if (restoreDbHandle) {
      await restoreDbHandle.cleanup();
      restoreDbHandle = null;
    }
  });

  it('rejects bad/missing cron secret, logs weekly messages idempotently, strips all secrets from export, and restores identical balances', async () => {
    dbHandle = await createIsolatedTestDb('weekly-backup');

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

    const m1Id = (
      (await (
        await createMemberRoute(
          makeJsonRequest('/api/admin/members', {
            method: 'POST',
            cookies: admin1.cookies,
            csrfToken: admin1.csrfToken,
            body: { name: 'Geeta Devi', mobile: '9876501111', role: 'MEMBER', initialSecret: '1357' },
          })
        )
      ).json()) as { member: { id: string } }
    ).member.id;

    const m2Id = (
      (await (
        await createMemberRoute(
          makeJsonRequest('/api/admin/members', {
            method: 'POST',
            cookies: admin1.cookies,
            csrfToken: admin1.csrfToken,
            body: { name: 'Ramesh Rao', mobile: '9876502222', role: 'MEMBER', initialSecret: '2468' },
          })
        )
      ).json()) as { member: { id: string } }
    ).member.id;

    const { POST: createCycleRoute } = await import('@/app/api/admin/cycles/route');
    const cycleId = (
      (await (
        await createCycleRoute(
          makeJsonRequest('/api/admin/cycles', {
            method: 'POST',
            cookies: admin1.cookies,
            csrfToken: admin1.csrfToken,
            body: {
              name: 'Samiti 2026',
              startDate: '2026-10-01',
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

    const { POST: recordContrib } = await import('@/app/api/admin/contributions/route');
    await recordContrib(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { cycleId, memberId: m1Id, monthIndex: 1, amountPaise: 100_000, effectiveDate: '2026-10-05' },
      })
    );
    await recordContrib(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { cycleId, memberId: m2Id, monthIndex: 1, amountPaise: 100_000, effectiveDate: '2026-10-05' },
      })
    );

    const { POST: requestLoan } = await import('@/app/api/admin/loans/route');
    const loanRes = (await (
      await requestLoan(
        makeJsonRequest('/api/admin/loans', {
          method: 'POST',
          cookies: admin1.cookies,
          csrfToken: admin1.csrfToken,
          body: { cycleId, memberId: m1Id, principalPaise: 150_000, disbursedDate: '2026-10-10' },
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

    const { POST: repayLoan } = await import('@/app/api/admin/loans/[id]/repay/route');
    await repayLoan(
      makeJsonRequest(`/api/admin/loans/${loanRes.loan.id}/repay`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { amountPaise: 50_000, effectiveDate: '2026-11-05' },
      }),
      { params: Promise.resolve({ id: loanRes.loan.id }) }
    );

    // Cron endpoint checks secret strictly
    const { POST: cronPost, GET: cronGet } = await import('@/app/api/cron/weekly-reminders/route');
    const noSecret = await cronPost(makeJsonRequest('/api/cron/weekly-reminders', { method: 'POST' }));
    expect(noSecret.status).toBe(401);

    const wrongSecret = await cronGet(
      makeJsonRequest('/api/cron/weekly-reminders', {
        method: 'GET',
        headers: { authorization: 'Bearer wrong-secret' },
      })
    );
    expect(wrongSecret.status).toBe(401);

    // First valid cron call in the week creates 1 MessageLog for the 1 member with an active loan
    const firstCron = await cronPost(
      makeJsonRequest('/api/cron/weekly-reminders', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      })
    );
    expect(firstCron.status).toBe(200);
    const firstCronBody = (await firstCron.json()) as {
      createdCount: number;
      skippedDuplicates: number;
    };
    expect(firstCronBody.createdCount).toBe(1);

    // Second cron call in the same week creates ZERO duplicates
    const secondCron = await cronPost(
      makeJsonRequest('/api/cron/weekly-reminders', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      })
    );
    expect(secondCron.status).toBe(200);
    const secondCronBody = (await secondCron.json()) as {
      createdCount: number;
      skippedDuplicates: number;
    };
    expect(secondCronBody.createdCount).toBe(0);
    expect(secondCronBody.skippedDuplicates).toBe(1);

    // Verify prepared message & click-to-chat link via /api/admin/messages
    const { GET: getMessages } = await import('@/app/api/admin/messages/route');
    const msgRes = await getMessages(
      makeJsonRequest('/api/admin/messages', { cookies: admin1.cookies })
    );
    expect(msgRes.status).toBe(200);
    const msgBody = (await msgRes.json()) as {
      messages: Array<{ clickToChatUrl: string; messageText: string; status: string }>;
    };
    expect(msgBody.messages).toHaveLength(1);
    expect(msgBody.messages[0]?.status).toBe('PREPARED');
    expect(msgBody.messages[0]?.clickToChatUrl).toContain('https://wa.me/');

    // Export JSON and CSV -> zero secret fields!
    const { GET: exportRoute } = await import('@/app/api/admin/export/route');
    const csvRes = await exportRoute(
      makeJsonRequest('/api/admin/export?format=csv', { cookies: admin1.cookies })
    );
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();
    expect(csvText).toContain('CONTRIBUTION');
    expect(csvText).not.toMatch(/pinHash|passwordHash|totpSecret|recoveryCode|csrfToken/i);

    const jsonExportStr = await exportAllData('json');
    expect(jsonExportStr).not.toMatch(/pinHash|passwordHash|totpSecret|recoveryCode|csrfToken|\$2[aby]\$/i);

    // Compute balances before restore
    const originalEntries = await getCycleLedgerEntries(cycleId);
    const origM1Savings = calculateMemberSavings(originalEntries, m1Id);
    const origTotals = calculateGroupTotals({
      entries: originalEntries,
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
          id: loanRes.loan.id,
          memberId: m1Id,
          disbursedDate: '2026-10-10',
          principalPaise: 150_000,
          interestRateBps: 300,
          interestMode: 'REDUCING_BALANCE',
        },
      ],
      asOfDate: '2026-11-05',
    });

    // Restore into a completely fresh empty DB and confirm identical balances
    restoreDbHandle = await createIsolatedTestDb('weekly-backup-restored');
    await restoreFromExportJson(jsonExportStr, restoreDbHandle.databaseUrl);

    const restoredEntries = await getCycleLedgerEntries(cycleId);
    const restoredM1Savings = calculateMemberSavings(restoredEntries, m1Id);
    const restoredTotals = calculateGroupTotals({
      entries: restoredEntries,
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
          id: loanRes.loan.id,
          memberId: m1Id,
          disbursedDate: '2026-10-10',
          principalPaise: 150_000,
          interestRateBps: 300,
          interestMode: 'REDUCING_BALANCE',
        },
      ],
      asOfDate: '2026-11-05',
    });

    expect(restoredM1Savings).toEqual(origM1Savings);
    expect(restoredTotals).toEqual(origTotals);
  });
});

