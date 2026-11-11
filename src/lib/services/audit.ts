import { desc } from 'drizzle-orm';
import { auditEvents, getDb, type AppDb } from '@/db';

export async function recordAuditEvent(
  input: {
    actorMemberId: string | null;
    actorRole: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
  dbOrTx: AppDb = getDb()
): Promise<void> {
  await dbOrTx.insert(auditEvents).values({
    actorMemberId: input.actorMemberId,
    actorRole: input.actorRole,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadataJson: input.metadata ?? {},
  });
}

export async function listAuditEvents(limit = 100) {
  const db = getDb();
  return db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(limit);
}

