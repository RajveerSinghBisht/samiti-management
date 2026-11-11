import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedSession } from '@/lib/auth/guards';
import {
  handleApiError,
  parseJsonBody,
  strictNonNegativeIntSchema,
} from '@/lib/http';
import {
  getMessagingProviderMode,
  getReversalApprovalThresholdPaise,
  updateSettings,
} from '@/lib/services/settings';

const patchSettingsSchema = z.object({
  reversalApprovalThresholdPaise: strictNonNegativeIntSchema.optional(),
  messagingProvider: z.enum(['prepare', 'send']).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  try {
    return NextResponse.json({
      settings: {
        reversalApprovalThresholdPaise: await getReversalApprovalThresholdPaise(),
        messagingProvider: await getMessagingProviderMode(),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuthenticatedSession(req, { requireAdmin: true });
  if ('errorResponse' in auth) return auth.errorResponse;

  const parsed = await parseJsonBody(req, patchSettingsSchema);
  if ('errorResponse' in parsed) return parsed.errorResponse;

  try {
    const updated = await updateSettings({
      ...parsed.data,
      adminId: auth.session.memberId,
    });
    return NextResponse.json({ settings: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

