import { describe, it, expect, vi } from 'vitest';
import { withTransaction, type Database, type Transaction } from './executor.js';

/**
 * Transaction-helper tests. These run without a database by stubbing the
 * Drizzle `transaction` method: they verify that `withTransaction` delegates
 * to a single `db.transaction` call, forwards the executor, propagates the
 * return value on commit, and propagates the error (rollback) on throw.
 */
describe('withTransaction', () => {
  it('runs the work inside a single db.transaction call and forwards the executor', async () => {
    const tx = { marker: 'tx' } as unknown as Transaction;
    const transaction = vi.fn(async (work: (t: Transaction) => Promise<unknown>) => work(tx));
    const db = { transaction } as unknown as Database;

    const seen: Transaction[] = [];
    const result = await withTransaction(db, async (t) => {
      seen.push(t);
      return 'ok';
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([tx]);
    expect(result).toBe('ok');
  });

  it('propagates a thrown error so the transaction rolls back', async () => {
    const tx = {} as unknown as Transaction;
    const transaction = vi.fn(async (work: (t: Transaction) => Promise<unknown>) => work(tx));
    const db = { transaction } as unknown as Database;

    const boom = new Error('invalid row — abort import');
    await expect(
      withTransaction(db, async () => {
        throw boom;
      }),
    ).rejects.toThrow(boom);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
