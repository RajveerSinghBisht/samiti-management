import { eq } from 'drizzle-orm';
import { getDb, settings, type AppDb } from '@/db';
import { getEnv } from '@/lib/env';
import { recordAuditEvent } from './audit';

export const SETTING_KEYS = {
  REVERSAL_THRESHOLD_PAISE: 'reversalApprovalThresholdPaise',
  MESSAGING_PROVIDER: 'messagingProvider',
} as const;

export async function getSettingValue<T>(
  key: string,
  fallback: T,
  dbOrTx: AppDb = getDb()
): Promise<T> {
  const rows = await dbOrTx.select().from(settings).where(eq(settings.key, key)).limit(1);
  const row = rows.at(0);
  if (!row) return fallback;
  return row.valueJson as T;
}

export async function getReversalApprovalThresholdPaise(
  dbOrTx: AppDb = getDb()
): Promise<number> {
  const envDefault = getEnv().REVERSAL_APPROVAL_THRESHOLD_PAISE;
  const val = await getSettingValue<unknown>(
    SETTING_KEYS.REVERSAL_THRESHOLD_PAISE,
    envDefault,
    dbOrTx
  );
  if (typeof val === 'number' && Number.isSafeInteger(val) && val >= 0) {
    return val;
  }
  return envDefault;
}

export async function getMessagingProviderMode(
  dbOrTx: AppDb = getDb()
): Promise<'prepare' | 'send'> {
  const envDefault = getEnv().MESSAGING_PROVIDER;
  const val = await getSettingValue<unknown>(
    SETTING_KEYS.MESSAGING_PROVIDER,
    envDefault,
    dbOrTx
  );
  if (val === 'prepare' || val === 'send') {
    return val;
  }
  return envDefault;
}

export async function updateSettings(input: {
  reversalApprovalThresholdPaise?: number;
  messagingProvider?: 'prepare' | 'send';
  adminId: string;
}) {
  const db = getDb();
  if (input.reversalApprovalThresholdPaise !== undefined) {
    await db
      .insert(settings)
      .values({
        key: SETTING_KEYS.REVERSAL_THRESHOLD_PAISE,
        valueJson: input.reversalApprovalThresholdPaise,
        updatedByAdminId: input.adminId,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          valueJson: input.reversalApprovalThresholdPaise,
          updatedByAdminId: input.adminId,
          updatedAt: new Date(),
        },
      });
  }
  if (input.messagingProvider !== undefined) {
    await db
      .insert(settings)
      .values({
        key: SETTING_KEYS.MESSAGING_PROVIDER,
        valueJson: input.messagingProvider,
        updatedByAdminId: input.adminId,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          valueJson: input.messagingProvider,
          updatedByAdminId: input.adminId,
          updatedAt: new Date(),
        },
      });
  }

  await recordAuditEvent({
    actorMemberId: input.adminId,
    actorRole: 'ADMIN',
    action: 'UPDATE_SETTINGS',
    targetType: 'settings',
    metadata: {
      reversalApprovalThresholdPaise: input.reversalApprovalThresholdPaise,
      messagingProvider: input.messagingProvider,
    },
  });

  return {
    reversalApprovalThresholdPaise: await getReversalApprovalThresholdPaise(db),
    messagingProvider: await getMessagingProviderMode(db),
  };
}

