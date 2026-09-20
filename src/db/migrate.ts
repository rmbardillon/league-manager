/**
 * Migration runner. Applies pending Drizzle migrations from the ./drizzle folder.
 *
 * Usage: `npm run db:migrate` (generate SQL first with `npm run db:generate`).
 */
// Load .env first so DATABASE_URL from the file is honored.
import '../loadEnv.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main(): Promise<void> {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/league_manager';

  // A dedicated single-connection client is recommended for running migrations.
  const migrationClient = postgres(connectionString, { max: 1 });
  try {
    await migrate(drizzle(migrationClient), { migrationsFolder: './drizzle' });
    console.log('Migrations applied successfully.');
  } finally {
    await migrationClient.end();
  }
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
