import { eq } from 'drizzle-orm';
import { auditEvents, closeDb, getDb, members } from '@/db';
import { getEnv, resetEnvCacheForTests } from '@/lib/env';
import { hashPassword, validateAdminPasswordFormat } from './crypto';

export async function seedFirstAdmin(input: {
  name: string;
  mobile: string;
  password: string;
  databaseUrl?: string;
}): Promise<{ id: string; name: string; mobile: string; role: 'ADMIN' }> {
  const name = input.name.trim();
  const mobile = input.mobile.trim();

  if (name.length < 2 || name.length > 100) {
    throw new Error('Admin name must be 2 to 100 characters');
  }
  if (!/^\d{10}$/.test(mobile)) {
    throw new Error('Mobile number must be exactly 10 digits');
  }
  if (!validateAdminPasswordFormat(input.password)) {
    throw new Error('Admin password must be at least 12 characters');
  }

  if (input.databaseUrl && input.databaseUrl !== process.env.DATABASE_URL) {
    await closeDb();
    process.env.DATABASE_URL = input.databaseUrl;
    resetEnvCacheForTests();
  }

  const env = getEnv();
  const db = getDb();

  const existingAdmins = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.role, 'ADMIN'))
    .limit(1);

  if (existingAdmins.length > 0) {
    throw new Error('An admin already exists. First-admin seed is one-time only.');
  }

  const existingMobile = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.mobile, mobile))
    .limit(1);
  if (existingMobile.length > 0) {
    throw new Error('Mobile number already registered');
  }

  const passwordHash = await hashPassword(input.password, env.PIN_PEPPER);

  const inserted = await db
    .insert(members)
    .values({
      name,
      mobile,
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash,
      totpEnabled: false,
      mustChangePin: false,
    })
    .returning({
      id: members.id,
      name: members.name,
      mobile: members.mobile,
      role: members.role,
    });

  const admin = inserted.at(0);
  if (!admin) {
    throw new Error('Failed to create initial admin');
  }

  await db.insert(auditEvents).values({
    actorMemberId: admin.id,
    actorRole: 'SYSTEM_SEED',
    action: 'SEED_FIRST_ADMIN',
    targetType: 'member',
    targetId: admin.id,
    metadataJson: { mobile: admin.mobile },
  });

  return {
    id: admin.id,
    name: admin.name,
    mobile: admin.mobile,
    role: 'ADMIN',
  };
}

