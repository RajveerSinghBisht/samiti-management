import { applyMigrations } from '../src/db/migrate';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  await applyMigrations(databaseUrl);
  console.log('Migrations applied successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

