import fs from 'node:fs';
import path from 'node:path';
import { applyMigrations } from '../src/db/migrate';

async function main() {
  let databaseUrl = process.env.DATABASE_URL;
  const envLocalPath = path.resolve(process.cwd(), '.env.local');
  if (!databaseUrl && fs.existsSync(envLocalPath)) {
    const envContent = fs.readFileSync(envLocalPath, 'utf8');
    const match = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
    if (match) databaseUrl = match[1];
  }
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

