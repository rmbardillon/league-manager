/**
 * PostgreSQL access layer.
 *
 * Provides a typed Drizzle client backed by the `postgres` driver. The connection
 * string is read from DATABASE_URL (see .env.example).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/league_manager';

/** Raw postgres.js connection. Exported so callers can manage transactions/pools. */
export const sql = postgres(connectionString);

/** Typed Drizzle database instance bound to the full schema. */
export const db = drizzle(sql, { schema });

export type Database = typeof db;
