/**
 * Loads environment variables from a `.env` file at the repository root.
 *
 * This module MUST be imported (for its side effect) at the very top of every
 * process entry point — before anything that reads `process.env` at import
 * time, most importantly `src/db/client.ts`, which resolves `DATABASE_URL`
 * when the module first loads.
 *
 * It relies on Node's built-in `process.loadEnvFile()` (Node 20.12+/22), so no
 * extra dependency is required. A missing `.env` is not an error: local runs
 * fall back to real environment variables (or the built-in defaults), so the
 * call is guarded and any failure is logged and swallowed.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env file (or it could not be read) — fall back to the ambient
  // environment and the defaults baked into the DB client. This is expected
  // in CI and container environments that inject env vars directly.
}
