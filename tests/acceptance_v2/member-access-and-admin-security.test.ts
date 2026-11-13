import { describe, expect, it } from 'vitest';
import { makeJsonRequest, setupV2TestEnv } from './helpers';

/**
 * ACCEPTANCE V2: FEATURE 5 — MEMBER ACCESS, 6-DIGIT PINS & ADMIN SECURITY
 */
describe('Acceptance V2: Member Access, 6-Digit PINs & Admin Security', () => {
  it('enforces 6-digit PIN validation, temporary PIN lifecycle, forced change, session invalidation, and cross-admin reset', async () => {
    const { admin1, admin2 } = await setupV2TestEnv('member-access-and-admin-security');

    const { POST: createCycle } = await import('@/app/api/admin/cycles/route');
    const { POST: createMember } = await import('@/app/api/admin/members/route');
    const { POST: resetMemberPin } = await import('@/app/api/admin/members/[id]/reset-pin/route');
    const { POST: memberLogin } = await import('@/app/api/auth/member/login/route');
    const { POST: memberChangePin } = await import('@/app/api/auth/member/change-pin/route');
    const { POST: resetAdminCredentials } = await import('@/app/api/admin/admins/[id]/reset-credentials/route');

    const cycleRes = await createCycle(
      makeJsonRequest('/api/admin/cycles', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          name: 'Security Test Cycle',
          startDate: '2026-01-01',
          lengthMonths: 12,
          monthlyContributionPaise: 100_000,
          interestRateBps: 100,
          interestMode: 'REDUCING_BALANCE',
          interestSharingMode: 'EQUAL',
        },
      })
    );
    const { cycle } = await cycleRes.json();

    // 1. Require strictly 6 digits for new member creation
    const invalidPinRes = await createMember(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { cycleId: cycle.id, name: 'Short Pin Member', mobile: '9866611111', initialSecret: '1234' },
      })
    );
    expect(invalidPinRes.status).toBe(400);

    // Create member with valid 6-digit temporary PIN
    const createRes = await createMember(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { cycleId: cycle.id, name: 'Sarla Devi', mobile: '9866622222', initialSecret: '654321' },
      })
    );
    expect(createRes.status).toBe(201);
    const { member, temporaryPin } = await createRes.json();
    expect(temporaryPin).toBe('654321');
    expect(member.mustChangePin).toBe(true);

    // 2. Member logs in with temporary PIN -> mustChangePin is true
    const loginRes = await memberLogin(
      makeJsonRequest('/api/auth/member/login', {
        method: 'POST',
        body: { mobile: '9866622222', pin: '654321' },
      })
    );
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.mustChangePin).toBe(true);

    const memberCookies = loginRes.headers.get('set-cookie') || '';

    // 3. Member changes PIN to a new strictly 6-digit PIN
    const changeRes = await memberChangePin(
      makeJsonRequest('/api/auth/member/change-pin', {
        method: 'POST',
        cookies: memberCookies,
        csrfToken: loginData.csrfToken,
        body: {
          currentPin: '654321',
          newPin: '987654',
        },
      })
    );
    expect(changeRes.status).toBe(200);

    // 4. Admin Reset PIN:
    const resetRes = await resetMemberPin(
      makeJsonRequest(`/api/admin/members/${member.id}/reset-pin`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {},
      }),
      { params: Promise.resolve({ id: member.id }) }
    );
    expect(resetRes.status).toBe(200);
    const resetData = await resetRes.json();
    expect(resetData.temporaryPin).toMatch(/^\d{6}$/);

    const oldSessionAttempt = await memberChangePin(
      makeJsonRequest('/api/auth/member/change-pin', {
        method: 'POST',
        cookies: memberCookies,
        csrfToken: loginData.csrfToken,
        body: { currentPin: '987654', newPin: '112233' },
      })
    );
    expect(oldSessionAttempt.status).toBe(401);

    // 5. Admin Passwords & TOTP can be reset ONLY by a DIFFERENT admin, never self-reset
    const selfAdminReset = await resetAdminCredentials(
      makeJsonRequest(`/api/admin/admins/${admin1.adminId}/reset-credentials`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { newPassword: 'AnotherStrongPassword#2026' },
      }),
      { params: Promise.resolve({ id: admin1.adminId }) }
    );
    expect(selfAdminReset.status).toBe(403);

    const differentAdminReset = await resetAdminCredentials(
      makeJsonRequest(`/api/admin/admins/${admin1.adminId}/reset-credentials`, {
        method: 'POST',
        cookies: admin2.cookies,
        csrfToken: admin2.csrfToken,
        body: { newPassword: 'AnotherStrongPassword#2026' },
      }),
      { params: Promise.resolve({ id: admin1.adminId }) }
    );
    expect(differentAdminReset.status).toBe(200);
  });
});
