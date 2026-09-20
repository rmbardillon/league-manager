/**
 * Shared executor + transaction plumbing for the Repository Layer.
 *
 * Every repository method accepts an {@link Executor}: either the top-level
 * Drizzle {@link Database} handle or a transaction handle passed to the
 * callback of {@link withTransaction}. Because both expose the same query
 * builder surface, a repository call runs identically whether it stands alone
 * (its own implicit transaction) or participates in a larger multi-write
 * transaction.
 *
 * This is the mechanism behind the all-or-nothing guarantees required for
 * batch import (Req 11.3) and multi-write use cases such as recording a Score
 * and the completion of its Game together (Req 6.1).
 *
 * The Repository Layer is data-access only — no business logic, no validation
 * beyond what the database schema enforces.
 *
 * _Requirements: 3.7, 6.1, 11.3_
 */
import type { db as database } from '../db/client.js';

/** The concrete Drizzle database instance type. */
export type Database = typeof database;

/**
 * The transaction handle Drizzle passes to a {@link Database.transaction}
 * callback. It exposes the same query-builder methods as {@link Database}.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * A query executor: either the root database handle or an in-flight
 * transaction. Repositories are written against this union so the same code
 * path serves standalone and transactional writes.
 */
export type Executor = Database | Transaction;

/**
 * Run `work` inside a single database transaction. If the callback throws,
 * the transaction is rolled back and nothing is persisted (all-or-nothing);
 * if it returns, the transaction commits and the return value is forwarded.
 *
 * Pass the provided `tx` executor to every repository call inside `work` so
 * the writes share one atomic unit.
 *
 * @example
 * await withTransaction(db, async (tx) => {
 *   await scoreRepository.create(score, tx);
 *   await gameRepository.markCompleted(gameId, tx);
 * });
 */
export function withTransaction<T>(
  db: Database,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(work);
}
