import { afterEach, describe, expect, it } from 'vitest';
import {
  createIsolatedTestDb,
  getPreLoginCsrf,
  loginAdminWithTotpSetup,
  makeJsonRequest,
  mergeCookieJar,
  type TestDbHandle,
} from './helpers';
import { seedFirstAdmin } from '@/lib/auth/seed';

describe('G9 Authorization Matrix across anonymous, member, unverified-admin, and admin', () => {
  let dbHandle: TestDbHandle | null = null;

  afterEach(async () => {
    if (dbHandle) {
      await dbHandle.cleanup();
      dbHandle = null;
    }
  });

  it('denies anonymous (401) and member (403) access to every admin route and isolates member A from member B', async () => {
    dbHandle = await createIsolatedTestDb('authz-matrix');

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

    // Create Member A and Member B
    const memARes = await createMemberRoute(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { name: 'Member Alpha', mobile: '9800000001', role: 'MEMBER', initialSecret: '1111' },
      })
    );
    const memBRes = await createMemberRoute(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { name: 'Member Beta', mobile: '9800000002', role: 'MEMBER', initialSecret: '2222' },
      })
    );
    const memberAId = ((await memARes.json()) as { member: { id: string } }).member.id;
    const memberBId = ((await memBRes.json()) as { member: { id: string } }).member.id;

    // Create cycle, record distinctive contributions & loan for B
    const { POST: createCycleRoute } = await import('@/app/api/admin/cycles/route');
    const cycleId = (
      (await (
        await createCycleRoute(
          makeJsonRequest('/api/admin/cycles', {
            method: 'POST',
            cookies: admin1.cookies,
            csrfToken: admin1.csrfToken,
            body: {
              name: 'Matrix Cycle',
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

    const { POST: recordContrib } = await import('@/app/api/admin/contributions/route');
    await recordContrib(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { cycleId, memberId: memberAId, monthIndex: 1, amountPaise: 100_000, effectiveDate: '2026-01-05' },
      })
    );
    await recordContrib(
      makeJsonRequest('/api/admin/contributions', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { cycleId, memberId: memberBId, monthIndex: 1, amountPaise: 300_000, effectiveDate: '2026-01-05' },
      })
    );

    const { POST: requestLoan } = await import('@/app/api/admin/loans/route');
    const loanB = (await (
      await requestLoan(
        makeJsonRequest('/api/admin/loans', {
          method: 'POST',
          cookies: admin1.cookies,
          csrfToken: admin1.csrfToken,
          body: { cycleId, memberId: memberBId, principalPaise: 250_000, disbursedDate: '2026-01-10' },
        })
      )
    ).json()) as { loan: { id: string }; approval: { id: string } };

    const { POST: decideApproval } = await import('@/app/api/admin/approvals/[id]/decide/route');
    await decideApproval(
      makeJsonRequest(`/api/admin/approvals/${loanB.approval.id}/decide`, {
        method: 'POST',
        cookies: admin2.cookies,
        csrfToken: admin2.csrfToken,
        body: { decision: 'APPROVE' },
      }),
      { params: Promise.resolve({ id: loanB.approval.id }) }
    );

    // Log in as Member A
    const preM = await getPreLoginCsrf();
    const { POST: memberLogin } = await import('@/app/api/auth/member/login/route');
    const loginARes = await memberLogin(
      makeJsonRequest('/api/auth/member/login', {
        method: 'POST',
        cookies: preM.cookies,
        csrfToken: preM.csrfToken,
        body: { mobile: '9800000001', pin: '1111' },
      })
    );
    const loginABody = (await loginARes.json()) as { csrfToken: string };
    const memACookies = mergeCookieJar(preM.cookies, loginARes);

    // Create an unverified admin (Admin 3) who hasn't completed TOTP setup
    await createMemberRoute(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          name: 'Admin Three',
          mobile: '9999900003',
          role: 'ADMIN',
          initialSecret: 'ThirdStrongAdminPass#789',
        },
      })
    );
    const preA3 = await getPreLoginCsrf();
    const { POST: adminLogin } = await import('@/app/api/auth/admin/login/route');
    const a3Res = await adminLogin(
      makeJsonRequest('/api/auth/admin/login', {
        method: 'POST',
        cookies: preA3.cookies,
        csrfToken: preA3.csrfToken,
        body: { mobile: '9999900003', password: 'ThirdStrongAdminPass#789' },
      })
    );
    const a3Body = (await a3Res.json()) as { csrfToken: string };
    const unverifiedAdminCookies = mergeCookieJar(preA3.cookies, a3Res);

    // Matrix of routes
    const { GET: memSummary } = await import('@/app/api/member/summary/route');
    const { GET: memLoan } = await import('@/app/api/member/loan/route');
    const { GET: memSavings } = await import('@/app/api/member/savings/route');
    const { GET: memMeetings } = await import('@/app/api/member/meetings/route');
    const { GET: adminMembersGet, POST: adminMembersPost } = await import('@/app/api/admin/members/route');
    const { PATCH: adminMemberPatch } = await import('@/app/api/admin/members/[id]/route');
    const { POST: adminResetPin } = await import('@/app/api/admin/members/[id]/reset-pin/route');
    const { GET: adminCyclesGet, POST: adminCyclesPost } = await import('@/app/api/admin/cycles/route');
    const { POST: adminCycleClose } = await import('@/app/api/admin/cycles/[id]/close/route');
    const { GET: adminContribGet, POST: adminContribPost } = await import('@/app/api/admin/contributions/route');
    const { GET: adminLoansGet, POST: adminLoansPost } = await import('@/app/api/admin/loans/route');
    const { POST: adminLoanRepay } = await import('@/app/api/admin/loans/[id]/repay/route');
    const { POST: adminLoanAccrue } = await import('@/app/api/admin/loans/[id]/accrue/route');
    const { POST: adminReverse } = await import('@/app/api/admin/ledger/reverse/route');
    const { GET: adminApprovalsGet } = await import('@/app/api/admin/approvals/route');
    const { GET: adminMeetingsGet, POST: adminMeetingsPost } = await import('@/app/api/admin/meetings/route');
    const { GET: adminMessagesGet } = await import('@/app/api/admin/messages/route');
    const { GET: adminAuditGet } = await import('@/app/api/admin/audit/route');
    const { GET: adminExportGet } = await import('@/app/api/admin/export/route');
    const { GET: adminSettingsGet, PATCH: adminSettingsPatch } = await import('@/app/api/admin/settings/route');

    const memberRoutes: Array<() => Promise<Response>> = [
      () => memSummary(makeJsonRequest('/api/member/summary')),
      () => memLoan(makeJsonRequest('/api/member/loan')),
      () => memSavings(makeJsonRequest('/api/member/savings')),
      () => memMeetings(makeJsonRequest('/api/member/meetings')),
    ];
    for (const callAnon of memberRoutes) {
      expect((await callAnon()).status).toBe(401);
    }

    const adminChecks: Array<{
      anon: () => Promise<Response>;
      member: () => Promise<Response>;
      unverifiedAdmin: () => Promise<Response>;
    }> = [
      {
        anon: () => adminMembersGet(makeJsonRequest('/api/admin/members')),
        member: () => adminMembersGet(makeJsonRequest('/api/admin/members', { cookies: memACookies })),
        unverifiedAdmin: () => adminMembersGet(makeJsonRequest('/api/admin/members', { cookies: unverifiedAdminCookies })),
      },
      {
        anon: () => adminMembersPost(makeJsonRequest('/api/admin/members', { method: 'POST', body: {} })),
        member: () => adminMembersPost(makeJsonRequest('/api/admin/members', { method: 'POST', cookies: memACookies, csrfToken: loginABody.csrfToken, body: { name: 'X', mobile: '9111111111', role: 'MEMBER', initialSecret: '1234' } })),
        unverifiedAdmin: () => adminMembersPost(makeJsonRequest('/api/admin/members', { method: 'POST', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: {} })),
      },
      {
        anon: () => adminMemberPatch(makeJsonRequest(`/api/admin/members/${memberBId}`, { method: 'PATCH', body: {} }), { params: Promise.resolve({ id: memberBId }) }),
        member: () => adminMemberPatch(makeJsonRequest(`/api/admin/members/${memberBId}`, { method: 'PATCH', cookies: memACookies, csrfToken: loginABody.csrfToken, body: { name: 'Hacked' } }), { params: Promise.resolve({ id: memberBId }) }),
        unverifiedAdmin: () => adminMemberPatch(makeJsonRequest(`/api/admin/members/${memberBId}`, { method: 'PATCH', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: { name: 'Hacked' } }), { params: Promise.resolve({ id: memberBId }) }),
      },
      {
        anon: () => adminResetPin(makeJsonRequest(`/api/admin/members/${memberBId}/reset-pin`, { method: 'POST', body: {} }), { params: Promise.resolve({ id: memberBId }) }),
        member: () => adminResetPin(makeJsonRequest(`/api/admin/members/${memberBId}/reset-pin`, { method: 'POST', cookies: memACookies, csrfToken: loginABody.csrfToken, body: { newPin: '9999' } }), { params: Promise.resolve({ id: memberBId }) }),
        unverifiedAdmin: () => adminResetPin(makeJsonRequest(`/api/admin/members/${memberBId}/reset-pin`, { method: 'POST', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: { newPin: '9999' } }), { params: Promise.resolve({ id: memberBId }) }),
      },
      {
        anon: () => adminCyclesGet(makeJsonRequest('/api/admin/cycles')),
        member: () => adminCyclesGet(makeJsonRequest('/api/admin/cycles', { cookies: memACookies })),
        unverifiedAdmin: () => adminCyclesGet(makeJsonRequest('/api/admin/cycles', { cookies: unverifiedAdminCookies })),
      },
      {
        anon: () => adminCyclesPost(makeJsonRequest('/api/admin/cycles', { method: 'POST', body: {} })),
        member: () => adminCyclesPost(makeJsonRequest('/api/admin/cycles', { method: 'POST', cookies: memACookies, csrfToken: loginABody.csrfToken, body: {} })),
        unverifiedAdmin: () => adminCyclesPost(makeJsonRequest('/api/admin/cycles', { method: 'POST', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: {} })),
      },
      {
        anon: () => adminCycleClose(makeJsonRequest(`/api/admin/cycles/${cycleId}/close`, { method: 'POST', body: {} }), { params: Promise.resolve({ id: cycleId }) }),
        member: () => adminCycleClose(makeJsonRequest(`/api/admin/cycles/${cycleId}/close`, { method: 'POST', cookies: memACookies, csrfToken: loginABody.csrfToken, body: {} }), { params: Promise.resolve({ id: cycleId }) }),
        unverifiedAdmin: () => adminCycleClose(makeJsonRequest(`/api/admin/cycles/${cycleId}/close`, { method: 'POST', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: {} }), { params: Promise.resolve({ id: cycleId }) }),
      },
      {
        anon: () => adminContribGet(makeJsonRequest('/api/admin/contributions')),
        member: () => adminContribGet(makeJsonRequest('/api/admin/contributions', { cookies: memACookies })),
        unverifiedAdmin: () => adminContribGet(makeJsonRequest('/api/admin/contributions', { cookies: unverifiedAdminCookies })),
      },
      {
        anon: () => adminContribPost(makeJsonRequest('/api/admin/contributions', { method: 'POST', body: {} })),
        member: () => adminContribPost(makeJsonRequest('/api/admin/contributions', { method: 'POST', cookies: memACookies, csrfToken: loginABody.csrfToken, body: {} })),
        unverifiedAdmin: () => adminContribPost(makeJsonRequest('/api/admin/contributions', { method: 'POST', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: {} })),
      },
      {
        anon: () => adminLoansGet(makeJsonRequest('/api/admin/loans')),
        member: () => adminLoansGet(makeJsonRequest('/api/admin/loans', { cookies: memACookies })),
        unverifiedAdmin: () => adminLoansGet(makeJsonRequest('/api/admin/loans', { cookies: unverifiedAdminCookies })),
      },
      {
        anon: () => adminLoansPost(makeJsonRequest('/api/admin/loans', { method: 'POST', body: {} })),
        member: () => adminLoansPost(makeJsonRequest('/api/admin/loans', { method: 'POST', cookies: memACookies, csrfToken: loginABody.csrfToken, body: {} })),
        unverifiedAdmin: () => adminLoansPost(makeJsonRequest('/api/admin/loans', { method: 'POST', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: {} })),
      },
      {
        anon: () => adminLoanRepay(makeJsonRequest(`/api/admin/loans/${loanB.loan.id}/repay`, { method: 'POST', body: {} }), { params: Promise.resolve({ id: loanB.loan.id }) }),
        member: () => adminLoanRepay(makeJsonRequest(`/api/admin/loans/${loanB.loan.id}/repay`, { method: 'POST', cookies: memACookies, csrfToken: loginABody.csrfToken, body: {} }), { params: Promise.resolve({ id: loanB.loan.id }) }),
        unverifiedAdmin: () => adminLoanRepay(makeJsonRequest(`/api/admin/loans/${loanB.loan.id}/repay`, { method: 'POST', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: {} }), { params: Promise.resolve({ id: loanB.loan.id }) }),
      },
      {
        anon: () => adminLoanAccrue(makeJsonRequest(`/api/admin/loans/${loanB.loan.id}/accrue`, { method: 'POST', body: {} }), { params: Promise.resolve({ id: loanB.loan.id }) }),
        member: () => adminLoanAccrue(makeJsonRequest(`/api/admin/loans/${loanB.loan.id}/accrue`, { method: 'POST', cookies: memACookies, csrfToken: loginABody.csrfToken, body: {} }), { params: Promise.resolve({ id: loanB.loan.id }) }),
        unverifiedAdmin: () => adminLoanAccrue(makeJsonRequest(`/api/admin/loans/${loanB.loan.id}/accrue`, { method: 'POST', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: {} }), { params: Promise.resolve({ id: loanB.loan.id }) }),
      },
      {
        anon: () => adminReverse(makeJsonRequest('/api/admin/ledger/reverse', { method: 'POST', body: {} })),
        member: () => adminReverse(makeJsonRequest('/api/admin/ledger/reverse', { method: 'POST', cookies: memACookies, csrfToken: loginABody.csrfToken, body: {} })),
        unverifiedAdmin: () => adminReverse(makeJsonRequest('/api/admin/ledger/reverse', { method: 'POST', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: {} })),
      },
      {
        anon: () => adminApprovalsGet(makeJsonRequest('/api/admin/approvals')),
        member: () => adminApprovalsGet(makeJsonRequest('/api/admin/approvals', { cookies: memACookies })),
        unverifiedAdmin: () => adminApprovalsGet(makeJsonRequest('/api/admin/approvals', { cookies: unverifiedAdminCookies })),
      },
      {
        anon: () => adminMeetingsGet(makeJsonRequest('/api/admin/meetings')),
        member: () => adminMeetingsGet(makeJsonRequest('/api/admin/meetings', { cookies: memACookies })),
        unverifiedAdmin: () => adminMeetingsGet(makeJsonRequest('/api/admin/meetings', { cookies: unverifiedAdminCookies })),
      },
      {
        anon: () => adminMeetingsPost(makeJsonRequest('/api/admin/meetings', { method: 'POST', body: {} })),
        member: () => adminMeetingsPost(makeJsonRequest('/api/admin/meetings', { method: 'POST', cookies: memACookies, csrfToken: loginABody.csrfToken, body: {} })),
        unverifiedAdmin: () => adminMeetingsPost(makeJsonRequest('/api/admin/meetings', { method: 'POST', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: {} })),
      },
      {
        anon: () => adminMessagesGet(makeJsonRequest('/api/admin/messages')),
        member: () => adminMessagesGet(makeJsonRequest('/api/admin/messages', { cookies: memACookies })),
        unverifiedAdmin: () => adminMessagesGet(makeJsonRequest('/api/admin/messages', { cookies: unverifiedAdminCookies })),
      },
      {
        anon: () => adminAuditGet(makeJsonRequest('/api/admin/audit')),
        member: () => adminAuditGet(makeJsonRequest('/api/admin/audit', { cookies: memACookies })),
        unverifiedAdmin: () => adminAuditGet(makeJsonRequest('/api/admin/audit', { cookies: unverifiedAdminCookies })),
      },
      {
        anon: () => adminExportGet(makeJsonRequest('/api/admin/export?format=json')),
        member: () => adminExportGet(makeJsonRequest('/api/admin/export?format=json', { cookies: memACookies })),
        unverifiedAdmin: () => adminExportGet(makeJsonRequest('/api/admin/export?format=json', { cookies: unverifiedAdminCookies })),
      },
      {
        anon: () => adminSettingsGet(makeJsonRequest('/api/admin/settings')),
        member: () => adminSettingsGet(makeJsonRequest('/api/admin/settings', { cookies: memACookies })),
        unverifiedAdmin: () => adminSettingsGet(makeJsonRequest('/api/admin/settings', { cookies: unverifiedAdminCookies })),
      },
      {
        anon: () => adminSettingsPatch(makeJsonRequest('/api/admin/settings', { method: 'PATCH', body: {} })),
        member: () => adminSettingsPatch(makeJsonRequest('/api/admin/settings', { method: 'PATCH', cookies: memACookies, csrfToken: loginABody.csrfToken, body: {} })),
        unverifiedAdmin: () => adminSettingsPatch(makeJsonRequest('/api/admin/settings', { method: 'PATCH', cookies: unverifiedAdminCookies, csrfToken: a3Body.csrfToken, body: {} })),
      },
    ];

    for (const check of adminChecks) {
      expect((await check.anon()).status).toBe(401);
      expect((await check.member()).status).toBe(403);
      expect((await check.unverifiedAdmin()).status).toBe(403);
    }

    // Member A trying to pass ?memberId=memberBId to /api/member/* only receives Member A's own data!
    const loanAttempt = await memLoan(
      makeJsonRequest(`/api/member/loan?memberId=${memberBId}`, { cookies: memACookies })
    );
    expect(loanAttempt.status).toBe(200);
    const loanAttemptText = await loanAttempt.text();
    expect(loanAttemptText).not.toContain(memberBId);
    expect(loanAttemptText).not.toContain(loanB.loan.id);
    expect(loanAttemptText).not.toContain('Member Beta');

    const savingsAttempt = await memSavings(
      makeJsonRequest(`/api/member/savings?memberId=${memberBId}`, { cookies: memACookies })
    );
    expect(savingsAttempt.status).toBe(200);
    const savingsAttemptJson = (await savingsAttempt.json()) as {
      totalContributedPaise: number;
    };
    expect(savingsAttemptJson.totalContributedPaise).toBe(100_000); // Member A's Rs 1000, NOT B's Rs 3000

    // Also silence unused import check
    expect(typeof seedFirstAdmin).toBe('function');
  });
});

