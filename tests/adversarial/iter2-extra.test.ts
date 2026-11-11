import { afterEach, describe, expect, it } from 'vitest';
import {
  createIsolatedTestDb,
  getPreLoginCsrf,
  loginAdminWithTotpSetup,
  makeJsonRequest,
  mergeCookieJar,
  type TestDbHandle,
} from '../acceptance/helpers';
import { reverseLedgerEntry } from '@/lib/services/ledger';
import { calculateInterestShares, calculateMemberSavings } from '@/lib/calc';
import { getCycleLedgerEntries } from '@/lib/services/ledger';

describe('Iteration 2 adversarial extensions: concurrent reversal race, mid-cycle member exit, export secrecy', () => {
  let dbHandle: TestDbHandle | null = null;

  afterEach(async () => {
    if (dbHandle) {
      await dbHandle.cleanup();
      dbHandle = null;
    }
  });

  it('prevents concurrent double reversal and computes accurate proportional shares for mid-cycle exit / skipped months', async () => {
    dbHandle = await createIsolatedTestDb('adv-iter2');
    const admin = await loginAdminWithTotpSetup({
      name: 'Admin One',
      mobile: '9999900001',
      password: 'VeryStrongAdminPassword#123',
    });

    const { POST: createMemberRoute } = await import('@/app/api/admin/members/route');
    const m1 = (
      (await (
        await createMemberRoute(
          makeJsonRequest('/api/admin/members', {
            method: 'POST',
            cookies: admin.cookies,
            csrfToken: admin.csrfToken,
            body: { name: 'Member One', mobile: '9800011111', role: 'MEMBER', initialSecret: '1111' },
          })
        )
      ).json()) as { member: { id: string } }
    ).member.id;

    const m2 = (
      (await (
        await createMemberRoute(
          makeJsonRequest('/api/admin/members', {
            method: 'POST',
            cookies: admin.cookies,
            csrfToken: admin.csrfToken,
            body: { name: 'Member Two', mobile: '9800022222', role: 'MEMBER', initialSecret: '2222' },
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
            cookies: admin.cookies,
            csrfToken: admin.csrfToken,
            body: {
              name: 'Exit Cycle',
              startDate: '2026-01-01',
              lengthMonths: 12,
              monthlyContributionPaise: 50_000,
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
    const c1Res = await recordContrib(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin.cookies,
        csrfToken: admin.csrfToken,
        body: { cycleId, memberId: m1, monthIndex: 1, amountPaise: 50_000, effectiveDate: '2026-01-05' },
      })
    );
    const c1Id = ((await c1Res.json()) as { entry: { id: string } }).entry.id;

    // Member 1 pays Month 2 as well; Member 2 leaves mid-cycle after Month 1
    await recordContrib(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin.cookies,
        csrfToken: admin.csrfToken,
        body: { cycleId, memberId: m1, monthIndex: 2, amountPaise: 50_000, effectiveDate: '2026-02-05' },
      })
    );
    await recordContrib(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin.cookies,
        csrfToken: admin.csrfToken,
        body: { cycleId, memberId: m2, monthIndex: 1, amountPaise: 50_000, effectiveDate: '2026-01-05' },
      })
    );

    const { PATCH: patchMember } = await import('@/app/api/admin/members/[id]/route');
    const deactivateRes = await patchMember(
      makeJsonRequest(`/api/admin/members/${m2}`, {
        method: 'PATCH',
        cookies: admin.cookies,
        csrfToken: admin.csrfToken,
        body: { status: 'INACTIVE' },
      }),
      { params: Promise.resolve({ id: m2 }) }
    );
    expect(deactivateRes.status).toBe(200);

    // Inactive Member 2 cannot log in anymore
    const pre = await getPreLoginCsrf();
    const { POST: memberLogin } = await import('@/app/api/auth/member/login/route');
    const inactiveLogin = await memberLogin(
      makeJsonRequest('/api/auth/member/login', {
        method: 'POST',
        cookies: pre.cookies,
        csrfToken: pre.csrfToken,
        body: { mobile: '9800022222', pin: '2222' },
      })
    );
    expect(inactiveLogin.status).toBe(401);

    // Check proportional sharing before reversal: m1 contributed 100k, m2 contributed 50k -> 2:1 split of Rs 300 (30,000 paise)
    const entries = await getCycleLedgerEntries(cycleId);
    const shares = calculateInterestShares({
      totalInterestPoolPaise: 30_000,
      members: [
        { memberId: m1, totalContributedPaise: calculateMemberSavings(entries, m1).totalContributedPaise },
        { memberId: m2, totalContributedPaise: calculateMemberSavings(entries, m2).totalContributedPaise },
      ],
      sharingMode: 'PROPORTIONAL_CONTRIBUTION',
    });
    expect(shares).toEqual([
      { memberId: m1, sharePaise: 20_000 },
      { memberId: m2, sharePaise: 10_000 },
    ]);

    // Concurrent race to reverse c1Id: exactly 1 succeeds, 1 rejects
    const outcomes = await Promise.allSettled([
      reverseLedgerEntry({ ledgerEntryId: c1Id, reason: 'Race A', adminId: admin.adminId }),
      reverseLedgerEntry({ ledgerEntryId: c1Id, reason: 'Race B', adminId: admin.adminId }),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Member 1 cannot access export
    const loginM1 = await memberLogin(
      makeJsonRequest('/api/auth/member/login', {
        method: 'POST',
        cookies: pre.cookies,
        csrfToken: pre.csrfToken,
        body: { mobile: '9800011111', pin: '1111' },
      })
    );
    const m1Cookies = mergeCookieJar(pre.cookies, loginM1);
    const { GET: exportRoute } = await import('@/app/api/admin/export/route');
    const forbiddenExport = await exportRoute(
      makeJsonRequest('/api/admin/export?format=json', { cookies: m1Cookies })
    );
    expect(forbiddenExport.status).toBe(403);
  });
});

