import { describe, it, expect, vi, afterEach } from 'vitest';

import { AuthService } from './authService.js';
import { hashPassword } from '../api/auth/password.js';
import { INVALID_CREDENTIALS_MESSAGE, LOCKOUT_WINDOW_MS } from '../domain/auth.js';
import {
  AccountLockedError,
  AuthenticationError,
  ValidationError,
} from '../domain/errors.js';
import type { Session, User } from '../domain/types.js';
import type { Database, Transaction } from '../repositories/executor.js';
import { sessionRepository, userRepository } from '../repositories/index.js';

/**
 * AuthService unit tests (Requirement 1).
 *
 * These exercise the service without a real database: `db.transaction` is
 * stubbed to invoke the callback with a marker transaction, and the
 * User/Session repositories are spied. They verify:
 *   - a successful sign-in clears failures, creates a session, and returns the
 *     AuthUser (Req 1.1, 1.2)
 *   - a wrong password throws a generic AuthenticationError and records a failed
 *     attempt without disclosing the wrong field (Req 1.3, 1.6)
 *   - a locked account is rejected with AccountLockedError before any check (Req 1.6)
 *   - the failure that crosses the threshold locks the account (Req 1.6)
 *   - a missing field is a ValidationError (Req 1.4)
 *   - signOut deletes the session (Req 1.5)
 *   - me returns the AuthUser for a valid session and null otherwise
 */

/** A Database whose transaction runs the callback with a marker tx. */
function stubDb(): Database {
  const tx = { marker: 'tx' } as unknown as Transaction;
  const transaction = vi.fn(async (work: (t: Transaction) => Promise<unknown>) =>
    work(tx),
  );
  return { transaction } as unknown as Database;
}

const NOW = new Date('2024-01-01T12:00:00.000Z');

/** Build a stored User with a real scrypt hash of `password`. */
function makeUser(overrides: Partial<User> = {}, password = 'pw'): User {
  return {
    id: 'u-1',
    username: 'alice',
    passwordHash: hashPassword(password),
    role: 'Administrator',
    managedTeamIds: [],
    failedAttempts: [],
    lockedUntil: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    userId: 'u-1',
    role: 'Administrator',
    createdAt: NOW,
    lastActivityAt: NOW,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthService.signIn', () => {
  it('issues a session and returns the AuthUser on valid credentials (Req 1.1)', async () => {
    const user = makeUser({ managedTeamIds: ['t-1'] }, 'pw');
    vi.spyOn(userRepository, 'findByUsername').mockResolvedValue(user);
    const clear = vi.spyOn(userRepository, 'clearFailedAttempts').mockResolvedValue();
    const create = vi
      .spyOn(sessionRepository, 'create')
      .mockResolvedValue(makeSession());

    const svc = new AuthService(stubDb());
    const result = await svc.signIn({ username: 'alice', password: 'pw' }, NOW);

    expect(result.sessionId).toBe('sess-1');
    expect(result.user).toEqual({
      userId: 'u-1',
      username: 'alice',
      role: 'Administrator',
      managedTeamIds: ['t-1'],
    });
    expect(clear).toHaveBeenCalledWith('u-1', expect.anything());
    expect(create).toHaveBeenCalledWith(
      { userId: 'u-1', role: 'Administrator', lastActivityAt: NOW },
      expect.anything(),
    );
  });

  it('rejects a wrong password with a generic 401 and records a failed attempt (Req 1.3, 1.6)', async () => {
    const user = makeUser({}, 'pw');
    vi.spyOn(userRepository, 'findByUsername').mockResolvedValue(user);
    const record = vi
      .spyOn(userRepository, 'recordFailedAttempt')
      .mockResolvedValue();
    const create = vi.spyOn(sessionRepository, 'create');

    const svc = new AuthService(stubDb());
    await expect(
      svc.signIn({ username: 'alice', password: 'wrong' }, NOW),
    ).rejects.toMatchObject({
      constructor: AuthenticationError,
      message: INVALID_CREDENTIALS_MESSAGE,
    });
    expect(record).toHaveBeenCalledWith('u-1', NOW, expect.anything());
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an unknown username with the identical generic 401 (Req 1.3)', async () => {
    vi.spyOn(userRepository, 'findByUsername').mockResolvedValue(null);
    const record = vi.spyOn(userRepository, 'recordFailedAttempt');

    const svc = new AuthService(stubDb());
    await expect(
      svc.signIn({ username: 'ghost', password: 'whatever' }, NOW),
    ).rejects.toMatchObject({
      constructor: AuthenticationError,
      message: INVALID_CREDENTIALS_MESSAGE,
    });
    // No User → no failed attempt recorded (nothing to probe).
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects a currently locked account with 423 before verifying (Req 1.6)', async () => {
    // Six failures within the rolling window → locked.
    const failedAttempts = Array.from({ length: 6 }, (_, i) => ({
      at: new Date(NOW.getTime() - i * 1000),
    }));
    const user = makeUser({ failedAttempts }, 'pw');
    vi.spyOn(userRepository, 'findByUsername').mockResolvedValue(user);
    const record = vi.spyOn(userRepository, 'recordFailedAttempt');

    const svc = new AuthService(stubDb());
    // Even with the CORRECT password, a locked account is rejected.
    await expect(
      svc.signIn({ username: 'alice', password: 'pw' }, NOW),
    ).rejects.toBeInstanceOf(AccountLockedError);
    expect(record).not.toHaveBeenCalled();
  });

  it('locks the account on the failure that crosses the threshold (Req 1.6)', async () => {
    // Five prior failures within the window; the 6th (this attempt) locks.
    const failedAttempts = Array.from({ length: 5 }, (_, i) => ({
      at: new Date(NOW.getTime() - (i + 1) * 1000),
    }));
    const user = makeUser({ failedAttempts }, 'pw');
    vi.spyOn(userRepository, 'findByUsername').mockResolvedValue(user);
    vi.spyOn(userRepository, 'recordFailedAttempt').mockResolvedValue();

    const svc = new AuthService(stubDb());
    await expect(
      svc.signIn({ username: 'alice', password: 'wrong' }, NOW),
    ).rejects.toBeInstanceOf(AccountLockedError);
  });

  it('treats stale failures outside the window as not locking (Req 1.6)', async () => {
    // Six failures, but all older than the rolling window → not locked.
    const stale = new Date(NOW.getTime() - LOCKOUT_WINDOW_MS - 60_000);
    const user = makeUser(
      { failedAttempts: Array.from({ length: 6 }, () => ({ at: stale })) },
      'pw',
    );
    vi.spyOn(userRepository, 'findByUsername').mockResolvedValue(user);
    vi.spyOn(userRepository, 'clearFailedAttempts').mockResolvedValue();
    vi.spyOn(sessionRepository, 'create').mockResolvedValue(makeSession());

    const svc = new AuthService(stubDb());
    const result = await svc.signIn({ username: 'alice', password: 'pw' }, NOW);
    expect(result.sessionId).toBe('sess-1');
  });

  it('rejects a missing field with a 400 ValidationError (Req 1.4)', async () => {
    vi.spyOn(userRepository, 'findByUsername').mockResolvedValue(null);

    const svc = new AuthService(stubDb());
    await expect(
      svc.signIn({ username: '   ', password: 'pw' }, NOW),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a role-less User with the generic 401 and opens no session (Req 2.5)', async () => {
    const user = makeUser({ role: null }, 'pw');
    vi.spyOn(userRepository, 'findByUsername').mockResolvedValue(user);
    const create = vi.spyOn(sessionRepository, 'create');

    const svc = new AuthService(stubDb());
    await expect(
      svc.signIn({ username: 'alice', password: 'pw' }, NOW),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('AuthService.signOut', () => {
  it('deletes the session (Req 1.5)', async () => {
    const del = vi.spyOn(sessionRepository, 'delete').mockResolvedValue(true);

    const svc = new AuthService(stubDb());
    await svc.signOut('sess-1');

    expect(del).toHaveBeenCalledWith('sess-1', expect.anything());
  });
});

describe('AuthService.me', () => {
  it('returns the AuthUser for a valid session', async () => {
    vi.spyOn(sessionRepository, 'findById').mockResolvedValue(makeSession());
    vi.spyOn(userRepository, 'findById').mockResolvedValue(
      makeUser({ managedTeamIds: ['t-9'] }),
    );

    const svc = new AuthService(stubDb());
    const user = await svc.me('sess-1');
    expect(user).toEqual({
      userId: 'u-1',
      username: 'alice',
      role: 'Administrator',
      managedTeamIds: ['t-9'],
    });
  });

  it('returns null for an unknown session', async () => {
    vi.spyOn(sessionRepository, 'findById').mockResolvedValue(null);

    const svc = new AuthService(stubDb());
    expect(await svc.me('nope')).toBeNull();
  });

  it('returns null when the session User can no longer be resolved', async () => {
    vi.spyOn(sessionRepository, 'findById').mockResolvedValue(makeSession());
    vi.spyOn(userRepository, 'findById').mockResolvedValue(null);

    const svc = new AuthService(stubDb());
    expect(await svc.me('sess-1')).toBeNull();
  });
});
