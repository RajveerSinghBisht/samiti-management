import { closeDb } from '../src/db';
import { seedFirstAdmin } from '../src/lib/auth/seed';

async function main() {
  const name = process.env.SEED_ADMIN_NAME || process.argv[2] || '';
  const mobile = process.env.SEED_ADMIN_MOBILE || process.argv[3] || '';
  const password = process.env.SEED_ADMIN_PASSWORD || process.argv[4] || '';

  if (!name || !mobile || !password) {
    throw new Error(
      'Provide SEED_ADMIN_NAME, SEED_ADMIN_MOBILE, SEED_ADMIN_PASSWORD env vars (or CLI args: name mobile password)'
    );
  }

  const created = await seedFirstAdmin({ name, mobile, password });
  console.log(`Seeded initial admin: ${created.name} (${created.mobile}) [id=${created.id}]`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});

