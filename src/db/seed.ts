/**
 * Database seed script — creates the first (admin) user so sign-in works.
 *
 * Usage: `npm run db:seed` (after `npm run db:migrate`).
 *
 * Idempotent: if a user with the desired username already exists, nothing is
 * changed. Credentials are read from the environment with dev defaults:
 *
 *   SEED_ADMIN_USERNAME  (default: "admin")
 *   SEED_ADMIN_PASSWORD  (default: "admin123")  ← dev-only default; change it
 *
 * The password is only ever read from the environment (never hardcoded beyond
 * the clearly-documented dev default) and is hashed with the same
 * `hashPassword` scrypt scheme the Authentication_Service verifies against.
 *
 * As a convenience for immediately creating Seasons, a starter League row is
 * created when the `leagues` table is empty.
 */
// Load .env first so DATABASE_URL and SEED_* vars from the file are honored,
// before importing the DB client (which reads DATABASE_URL at import time).
import '../loadEnv.js';
import { hashPassword } from '../api/auth/password.js';
import { db, sql } from './client.js';
import { leagueRepository, userRepository, withTransaction } from '../repositories/index.js';

/** Default dev credentials used only when the corresponding env var is unset. */
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

async function main(): Promise<void> {
  const username = process.env.SEED_ADMIN_USERNAME ?? DEFAULT_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
  const usingDefaultPassword = process.env.SEED_ADMIN_PASSWORD == null;

  // Idempotency: skip if the admin already exists.
  const existing = await userRepository.findByUsername(username, db);
  if (existing != null) {
    console.log(`Admin user "${username}" already exists — nothing to do (seed is idempotent).`);
  } else {
    await withTransaction(db, async (tx) => {
      await userRepository.create(
        { username, passwordHash: hashPassword(password), role: 'Administrator' },
        [],
        tx,
      );
    });
    console.log(`Created Administrator user "${username}".`);
  }

  // Convenience: create a starter League if none exist yet (low-risk).
  const leagues = await leagueRepository.list(db);
  if (leagues.length === 0) {
    const league = await withTransaction(db, (tx) =>
      leagueRepository.create({ name: 'Main League' }, tx),
    );
    console.log(`Created starter League "${league.name}" (${league.id}).`);
  } else {
    console.log(`Found ${leagues.length} existing league(s) — skipping starter League.`);
  }

  console.log('');
  console.log('Seed complete.');
  console.log(`  Admin username: ${username}`);
  if (usingDefaultPassword) {
    console.log(
      '  Admin password: admin123 (DEFAULT — change it after first sign-in, or set SEED_ADMIN_PASSWORD).',
    );
  } else {
    console.log('  Admin password: (from SEED_ADMIN_PASSWORD)');
  }
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Close the postgres connection so the script process can exit.
    void sql.end();
  });
