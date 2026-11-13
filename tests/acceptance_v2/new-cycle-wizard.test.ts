import { describe, expect, it } from 'vitest';
import { makeJsonRequest, setupV2TestEnv } from './helpers';
import { getDb, cycles } from '@/db';
import { eq } from 'drizzle-orm';

/**
 * ACCEPTANCE V2: FEATURE 1 — NEW-CYCLE WIZARD & NO CYCLE DELETION
 */
describe('Acceptance V2: New-Cycle Wizard & Zero Deletion', () => {
  it('enforces multi-step validation, step-skipping prevention, two-admin confirmation, and blocks cycle deletion', async () => {
    const { admin1, admin2 } = await setupV2TestEnv('new-cycle-wizard');

    const { POST: wizardValidateStep } = await import('@/app/api/admin/cycle-wizard/validate-step/route');
    const { POST: wizardCreateCycle } = await import('@/app/api/admin/cycle-wizard/route');
    const { POST: wizardApproveCycle } = await import('@/app/api/admin/cycle-wizard/[id]/approve/route');
    const { DELETE: deleteCycleRoute } = await (async () => {
      try {
        return await import('@/app/api/admin/cycles/[id]/route' as string);
      } catch {
        return { DELETE: undefined };
      }
    })();

    // 1. Wizard Step-Skipping: Cannot jump directly to review or submit without completing prior steps
    const skippedStepRes = await wizardValidateStep(
      makeJsonRequest('/api/admin/cycle-wizard/validate-step', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          step: 4,
          stepData: {},
        },
      })
    );
    expect(skippedStepRes.status).toBe(400);

    // 2. Validate Step 1: Basics (name, start date, end date, meeting day)
    const step1Valid = await wizardValidateStep(
      makeJsonRequest('/api/admin/cycle-wizard/validate-step', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          step: 1,
          stepData: {
            name: 'Diwali 2026-2028 Cycle',
            startDate: '2026-11-01',
            endDate: '2028-11-01', // 24 months (2 years)
            meetingDayOfMonth: 10,
          },
        },
      })
    );
    expect(step1Valid.status).toBe(200);
    const step1Json = await step1Valid.json();
    expect(step1Json.computedDuration).toMatchObject({
      months: 24,
      years: 2,
    });

    // 3. Wizard creation requires two different admins to activate
    const initialWizardRes = await wizardCreateCycle(
      makeJsonRequest('/api/admin/cycle-wizard', {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {
          name: 'Diwali 2026-2028 Cycle',
          startDate: '2026-11-01',
          endDate: '2028-11-01',
          meetingDayOfMonth: 10,
          monthlyContributionPaise: 100_000, // Rs 1,000
          interestRateBps: 100, // default 1% per month
          normalLoanCapPaise: 5_000_000, // Rs 50,000
          emergencyLoanCapPaise: 10_000_000, // Rs 1,00,000
          interestSharingMode: 'EQUAL',
          rotationPayoutEnabled: false,
          adminIds: [admin1.adminId, admin2.adminId],
          members: [
            { name: 'Member 1', mobile: '9811100001', isReturning: true },
            { name: 'Member 2', mobile: '9811100002', isReturning: false },
          ],
        },
      })
    );
    expect(initialWizardRes.status).toBe(201);
    const wizardCycle = await initialWizardRes.json();
    expect(wizardCycle.status).toBe('PENDING_SECOND_ADMIN_APPROVAL');
    expect(wizardCycle.reviewSummary).toContain('Rs 1,000');
    expect(wizardCycle.reviewSummary).toContain('1 percent');

    // Admin 1 cannot approve their own creation
    const selfApprove = await wizardApproveCycle(
      makeJsonRequest(`/api/admin/cycle-wizard/${wizardCycle.id}/approve`, {
        method: 'POST',
        cookies: admin1.cookies,
        csrfToken: admin1.csrfToken,
        body: {},
      }),
      { params: Promise.resolve({ id: wizardCycle.id }) }
    );
    expect(selfApprove.status).toBe(403);

    // Admin 2 confirms and approves -> Cycle becomes ACTIVE and settings are locked
    const admin2Approve = await wizardApproveCycle(
      makeJsonRequest(`/api/admin/cycle-wizard/${wizardCycle.id}/approve`, {
        method: 'POST',
        cookies: admin2.cookies,
        csrfToken: admin2.csrfToken,
        body: {},
      }),
      { params: Promise.resolve({ id: wizardCycle.id }) }
    );
    expect(admin2Approve.status).toBe(200);

    // 4. Verification of NO cycle deletion anywhere:
    expect(deleteCycleRoute).toBeUndefined();

    const db = getDb();
    let dbDeleteFailed = false;
    try {
      await db.delete(cycles).where(eq(cycles.id, wizardCycle.id));
    } catch {
      dbDeleteFailed = true;
    }
    expect(dbDeleteFailed).toBe(true);
  });
});
