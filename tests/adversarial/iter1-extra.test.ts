import { afterEach, describe, expect, it } from 'vitest';
import {
  createIsolatedTestDb,
  getPreLoginCsrf,
  loginAdminWithTotpSetup,
  makeJsonRequest,
  mergeCookieJar,
  type TestDbHandle,
} from '../acceptance/helpers';

describe('Iteration 1 adversarial extensions: double-submit contribution, Hindi/long names, large amounts', () => {
  let dbHandle: TestDbHandle | null = null;

  afterEach(async () => {
    if (dbHandle) {
      await dbHandle.cleanup();
      dbHandle = null;
    }
  });

  it('rejects double-submit of same member/month contribution and handles Hindi long names + large amounts cleanly', async () => {
    dbHandle = await createIsolatedTestDb('adv-iter1');
    const admin = await loginAdminWithTotpSetup({
      name: 'Admin One',
      mobile: '9999900001',
      password: 'VeryStrongAdminPassword#123',
    });

    const { POST: createMemberRoute } = await import('@/app/api/admin/members/route');
    const hindiLongName =
      'श्रीमती कमलावती देवी राजपुरोहित वरिष्ठ नागरिक बचत समूह सदस्य';
    const mRes = await createMemberRoute(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin.cookies,
        csrfToken: admin.csrfToken,
        body: {
          name: hindiLongName,
          mobile: '9876501234',
          role: 'MEMBER',
          initialSecret: '123456',
        },
      })
    );
    expect(mRes.status).toBe(201);
    const memberId = ((await mRes.json()) as { member: { id: string } }).member.id;

    const { POST: createCycleRoute } = await import('@/app/api/admin/cycles/route');
    const cycleId = (
      (await (
        await createCycleRoute(
          makeJsonRequest('/api/admin/cycles', {
            method: 'POST',
            cookies: admin.cookies,
            csrfToken: admin.csrfToken,
            body: {
              name: 'Large Pool Cycle',
              startDate: '2026-01-01',
              lengthMonths: 60,
              monthlyContributionPaise: 5_000_000, // Rs 50,000/month
              interestRateBps: 200,
              interestMode: 'FLAT',
              interestSharingMode: 'EQUAL',
              rotationPayoutEnabled: true,
            },
          })
        )
      ).json()) as { cycle: { id: string } }
    ).cycle.id;

    const { POST: recordContrib } = await import('@/app/api/admin/contributions/route');
    const first = await recordContrib(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin.cookies,
        csrfToken: admin.csrfToken,
        body: {
          cycleId,
          memberId,
          monthIndex: 1,
          amountPaise: 5_000_000,
          effectiveDate: '2026-01-05',
        },
      })
    );
    expect(first.status).toBe(201);

    // Double submit of the exact same form -> 409 Conflict!
    const duplicate = await recordContrib(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin.cookies,
        csrfToken: admin.csrfToken,
        body: {
          cycleId,
          memberId,
          monthIndex: 1,
          amountPaise: 5_000_000,
          effectiveDate: '2026-01-05',
        },
      })
    );
    expect(duplicate.status).toBe(409);

    // Member logs in with 6-digit PIN and fetches savings cleanly
    const pre = await getPreLoginCsrf();
    const { POST: memberLogin } = await import('@/app/api/auth/member/login/route');
    const loginRes = await memberLogin(
      makeJsonRequest('/api/auth/member/login', {
        method: 'POST',
        cookies: pre.cookies,
        csrfToken: pre.csrfToken,
        body: { mobile: '9876501234', pin: '123456' },
      })
    );
    expect(loginRes.status).toBe(200);
    const memCookies = mergeCookieJar(pre.cookies, loginRes);

    const { GET: memberSummary } = await import('@/app/api/member/summary/route');
    const sumRes = await memberSummary(
      makeJsonRequest('/api/member/summary', { cookies: memCookies })
    );
    expect(sumRes.status).toBe(200);
    const sumJson = (await sumRes.json()) as {
      member: { name: string };
      savings: { totalContributedPaise: number };
    };
    expect(sumJson.member.name).toBe(hindiLongName);
    expect(sumJson.savings.totalContributedPaise).toBe(5_000_000);
  });
});

