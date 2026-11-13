import { describe, expect, it } from 'vitest';
import { makeJsonRequest, setupV2TestEnv } from './helpers';

/**
 * ACCEPTANCE V2: FEATURE 3 — MONTHLY MEETING FLOW & ADMIN DASHBOARD
 */
describe('Acceptance V2: Monthly Meeting Flow & Admin Dashboard', () => {
  it('walks through the monthly meeting guided flow, closes meeting, and serves phone-friendly dashboard data with pool available calculation', async () => {
    const { admin1 } = await setupV2TestEnv('meeting-flow-and-dashboard');

    const { POST: createCycle } = await import('@/app/api/admin/cycles/route');
    const { POST: createMember } = await import('@/app/api/admin/members/route');
    const { POST: conductMeeting } = await import('@/app/api/admin/meetings/conduct/route');
    const { POST: closeMeeting } = await import('@/app/api/admin/meetings/[id]/close/route');
    const { GET: getMonthlyDashboard } = await import('@/app/api/admin/dashboard/monthly/route');

    const cycleRes = await createCycle(
      makeJsonRequest('/api/admin/cycles', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          name: 'Monthly Meeting 2026',
          startDate: '2026-01-01',
          lengthMonths: 12,
          monthlyContributionPaise: 100_000, // Rs 1,000
          interestRateBps: 100, // 1%
          interestMode: 'REDUCING_BALANCE',
          interestSharingMode: 'EQUAL',
        },
      })
    );
    const { cycle } = await cycleRes.json();

    const mem1Res = await createMember(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { cycleId: cycle.id, name: 'Asha Devi', mobile: '9844411111', initialSecret: '123456' },
      })
    );
    const mem2Res = await createMember(
      makeJsonRequest('/api/admin/members', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { cycleId: cycle.id, name: 'Balwant Singh', mobile: '9844422222', initialSecret: '123456' },
      })
    );
    const { member: m1 } = await mem1Res.json();
    const { member: m2 } = await mem2Res.json();

    // 1. Conduct Monthly Meeting for January 2026
    const meetingRes = await conductMeeting(
      makeJsonRequest('/api/admin/meetings/conduct', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId: cycle.id,
          meetingDate: '2026-01-10',
          place: 'Asha Devi Residence, Village Central',
          attendances: [
            { memberId: m1.id, isPresent: true },
            { memberId: m2.id, isPresent: true },
          ],
          contributions: [
            { memberId: m1.id, paid: true, amountPaise: 100_000 },
            { memberId: m2.id, paid: false, amountPaise: 0 },
          ],
          borrowerRepayments: [],
          bankInterestPaise: 5_000, // Rs 50 bank interest
        },
      })
    );
    expect(meetingRes.status).toBe(201);
    const { meeting } = await meetingRes.json();

    // 2. Close Meeting with plain summary
    const closeRes = await closeMeeting(
      makeJsonRequest(`/api/admin/meetings/${meeting.id}/close`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: { summaryNote: 'January meeting concluded smoothly' },
      }),
      { params: Promise.resolve({ id: meeting.id }) }
    );
    expect(closeRes.status).toBe(200);
    const { meeting: closedMeeting } = await closeRes.json();
    expect(closedMeeting.status).toBe('CLOSED');

    // 3. Admin Monthly Dashboard
    const dashRes = await getMonthlyDashboard(
      makeJsonRequest(`/api/admin/dashboard/monthly?cycleId=${cycle.id}&month=2026-01`, {
        method: 'GET',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
      })
    );
    expect(dashRes.status).toBe(200);
    const dash = await dashRes.json();

    expect(dash.paidMembers).toContain(m1.id);
    expect(dash.unpaidMembers).toContain(m2.id);
    expect(dash.memberSummaries).toHaveLength(2);
    expect(dash.groupTotals.totalContributionsPaise).toBe(100_000);
    expect(dash.poolAvailableToLendPaise).toBe(105_000);
  });
});
