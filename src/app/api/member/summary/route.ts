import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import { getMemberPortalData } from '@/lib/services/member-portal';
import { handleApiError } from '@/lib/http';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req);
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    // Strictly scoped to auth.session.memberId; ignores any query param
    const data = await getMemberPortalData(auth.session.memberId);
    return NextResponse.json({
      member: {
        id: auth.session.memberId,
        name: auth.session.name,
        mobile: auth.session.mobile,
      },
      cycle: data.cycle,
      savings: data.savings,
      activeLoansCount: data.myLoans.filter((l) => l.status === 'ACTIVE').length,
      totalLoanOwedPaise: data.myLoans
        .filter((l) => l.status === 'ACTIVE')
        .reduce((acc, l) => acc + l.balance.totalOwedPaise, 0),
      groupTotals: data.groupTotals,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

