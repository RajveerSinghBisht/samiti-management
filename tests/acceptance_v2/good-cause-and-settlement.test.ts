import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { makeJsonRequest, setupV2TestEnv } from './helpers';
import { splitLargestRemainder } from '@/lib/money';

/**
 * ACCEPTANCE V2: FEATURE 4 — GIVE FOR A GOOD CAUSE & SETTLEMENT PREVIEW
 */
describe('Acceptance V2: Give for a Good Cause & Settlement Preview', () => {
  it('fast-check property: shares + grant always equal the original interest pool exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10_000, max: 10_000_000 }),
        fc.integer({ min: 1_000, max: 5_000_000 }),
        fc.integer({ min: 5, max: 60 }),
        (poolPaise, rawGrantPaise, memberCount) => {
          const grantPaise = Math.min(rawGrantPaise, poolPaise);
          const netPoolPaise = poolPaise - grantPaise;

          const memberWeights = Array.from({ length: memberCount }, (_, i) => ({
            id: `m-${i}`,
            weight: 1,
          }));

          const grantDeductions = splitLargestRemainder(grantPaise, memberWeights);
          const memberShares = splitLargestRemainder(netPoolPaise, memberWeights);

          const sumGrantDeductions = grantDeductions.reduce((acc, d) => acc + d.amountPaise, 0);
          const sumMemberShares = memberShares.reduce((acc, s) => acc + s.amountPaise, 0);

          expect(sumGrantDeductions).toBe(grantPaise);
          expect(sumMemberShares).toBe(netPoolPaise);
          expect(sumMemberShares + sumGrantDeductions).toBe(poolPaise);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('handles Good Cause workflow: approval, deduction confirmation, pool balance blocking, and settlement preview', async () => {
    const { admin1, admin2 } = await setupV2TestEnv('good-cause-and-settlement');

    const { POST: createCycle } = await import('@/app/api/admin/cycles/route');
    const { POST: createMember } = await import('@/app/api/admin/members/route');
    const { POST: previewGrantRoute } = await import('@/app/api/admin/good-cause/preview/route');
    const { POST: createGrantRoute } = await import('@/app/api/admin/good-cause/route');
    const { POST: decideApproval } = await import('@/app/api/admin/approvals/[id]/decide/route');
    const { GET: getSettlementPreview } = await import('@/app/api/admin/settlement/preview/route');

    const cycleRes = await createCycle(
      makeJsonRequest('/api/admin/cycles', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          name: 'Good Cause Test Cycle',
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

    for (let i = 1; i <= 3; i++) {
      await createMember(
        makeJsonRequest('/api/admin/members', {
          method: 'POST',
          cookies: admin1.cookies,
          csrfToken: admin1.csrfToken,
          body: { cycleId: cycle.id, name: `Member ${i}`, mobile: `985551111${i}`, initialSecret: '123456' },
        })
      );
    }

    // 1. Preview confirmation of member reductions before saving
    const previewRes = await previewGrantRoute(
      makeJsonRequest('/api/admin/good-cause/preview', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId: cycle.id,
          amountPaise: 30_000, // Rs 300
        },
      })
    );
    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview.memberReductions).toHaveLength(3);
    const sumReductions = preview.memberReductions.reduce(
      (a: number, b: { reductionPaise: number }) => a + b.reductionPaise,
      0
    );
    expect(sumReductions).toBe(30_000);

    // 2. Grant larger than interest collected so far is blocked without explicit double confirmation
    const unconfirmedOverGrant = await createGrantRoute(
      makeJsonRequest('/api/admin/good-cause', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId: cycle.id,
          meetingDate: '2026-01-10',
          recipient: 'Village School Library Fund',
          reason: 'Children study tables',
          amountPaise: 100_000,
          consentNote: 'All members agreed at January meeting',
          confirmedExceedsPool: false,
        },
      })
    );
    expect(unconfirmedOverGrant.status).toBe(400);

    const grantReq = await createGrantRoute(
      makeJsonRequest('/api/admin/good-cause', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          cycleId: cycle.id,
          meetingDate: '2026-01-10',
          recipient: 'Village School Library Fund',
          reason: 'Children study tables',
          amountPaise: 30_000,
          consentNote: 'All members agreed at January meeting',
          confirmedExceedsPool: true,
        },
      })
    );
    expect(grantReq.status).toBe(201);
    const { approvalId } = await grantReq.json();

    // 3. Second admin approves grant
    const approveGrant = await decideApproval(
      makeJsonRequest(`/api/admin/approvals/${approvalId}/decide`, {
        method: 'POST',
        cookies: admin2.cookies,
        csrfToken: admin2.csrfToken,
        body: { decision: 'APPROVED' },
      }),
      { params: Promise.resolve({ id: approvalId }) }
    );
    expect(approveGrant.status).toBe(200);

    // 4. Live settlement preview shows deduction of grant from interest pool
    const settleRes = await getSettlementPreview(
      makeJsonRequest(`/api/admin/settlement/preview?cycleId=${cycle.id}`, {
        method: 'GET',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
      })
    );
    expect(settleRes.status).toBe(200);
    const settlement = await settleRes.json();
    expect(settlement.totalGoodCauseGrantsPaise).toBe(30_000);
  });
});
