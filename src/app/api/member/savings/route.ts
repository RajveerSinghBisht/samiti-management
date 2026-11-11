import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { getMemberPortalData } from '@/lib/services/member-portal';
import { handleApiError } from '@/lib/http';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req);
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    const data = await getMemberPortalData(auth.session.memberId);
    return NextResponse.json({
      cycle: data.cycle,
      totalContributedPaise: data.savings.totalContributedPaise,
      totalSharePayoutPaise: data.savings.totalSharePayoutPaise,
      totalRotationReceivedPaise: data.savings.totalRotationReceivedPaise,
      contributionCount: data.savings.contributionCount,
      entries: data.myContributionEntries,
      groupTotals: data.groupTotals,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

