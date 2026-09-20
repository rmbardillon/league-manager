/**
 * AuthService — sign-in, sign-out, and current-principal resolution (Requirement 1).
 *
 * Orchestrates the Authentication_Service use cases by delegating the pure
 * decisions to the domain functions in src/domain/auth.ts (`verifyCredentials`,
 * `lockoutState`) and persisting/reading Users and Sessions through the
 * Repository Layer. It contains no HTTP concerns; the API layer (auth router)
 * maps the returned {@link AuthUser}/session id and the thrown {@link DomainError}s
 * onto the wire.
 *
 * Responsibilities:
 * - `signIn({ username, password }, now)` — inside a single transaction: reject
 *   a locked account (Req 1.6); verify credentials without disclosing which
 *   field was wrong (Req 1.3); on a wrong password for an existing User record
 *   a failed attempt and re-evaluate the lock so the 6th failure locks (Req 1.6);
 *   on success clear the failed attempts and open a session. Returns the new
 *   session id and the authenticated principal.
 * - `signOut(sessionId)` — terminate a session (Req 1.5).
 * - `me(sessionId)` — resolve the {@link AuthUser} from a session, or `null`
 *   when the session/User cannot be resolved.
 *
 * The `sessions.role` column is NOT NULL, while a User's role may be `null`
 * (Req 2.5 denies such a User every action). A role-less User therefore cannot
 * open a session and is rejected with the same generic {@link AuthenticationError}
 * as an invalid credential, so sign-in never discloses account state.
 *
 * _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 2.5_
 */
import type { Role } from '../domain/types.js';
import { lockoutState, verifyCredentials } from '../domain/auth.js';
import {
  AccountLockedError,
  AuthenticationError,
  ValidationError,
} from '../domain/errors.js';
import type { Database } from '../repositories/executor.js';
import { withTransaction } from '../repositories/executor.js';
import { sessionRepository, userRepository } from '../repositories/index.js';
import { verifyPassword } from '../api/auth/password.js';

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/**
 * The authenticated principal, in the exact wire shape the SPA expects from
 * `POST /auth/signin` and `GET /auth/me`. `role` is `null` for a User with no
 * assigned role, though such a User can never reach this shape via sign-in.
 */
export interface AuthUser {
  userId: string;
  username: string;
  role: Role | null;
  managedTeamIds: string[];
}

/** Outcome of a successful {@link AuthService.signIn}. */
export interface SignInResult {
  /** The freshly created session id (set as the HTTP-only session cookie). */
  sessionId: string;
  /** The authenticated principal. */
  user: AuthUser;
}

/** Generic sign-in credentials. */
export interface SignInCredentials {
  username: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Application service for authentication. Construct it with a {@link Database}
 * handle; `signIn` opens its own transaction so the credential check, the
 * failed-attempt record, and the session creation are one atomic unit.
 */
export class AuthService {
  constructor(private readonly db: Database) {}

  /**
   * Authenticate a credential pair and open a session (Req 1.2–1.6).
   *
   * Flow (all inside one transaction):
   *  1. Load the User by username.
   *  2. If the account is currently locked, reject with 423 (Req 1.6).
   *  3. Verify the credentials via the pure `verifyCredentials`. A missing
   *     field is a 400 ValidationError (Req 1.4). An invalid credential is a
   *     generic 401 AuthenticationError; when the User exists, the failed
   *     attempt is recorded and the lock re-evaluated so the 6th failure within
   *     the window locks the account (Req 1.3, 1.6).
   *  4. On success, clear the failed attempts and create a session bound to the
   *     User's role. A role-less User cannot open a session and is rejected with
   *     the same generic 401 (Req 2.5).
   *
   * @param credentials The submitted username/password.
   * @param now         The current time (injectable for tests); defaults to now.
   */
  async signIn(
    credentials: SignInCredentials,
    now: Date = new Date(),
  ): Promise<SignInResult> {
    return withTransaction(this.db, async (tx) => {
      const user = await userRepository.findByUsername(credentials.username, tx);

      // Req 1.6: reject every attempt while the account is locked.
      if (user != null) {
        const lock = lockoutState(user.failedAttempts, now);
        if (lock.locked) {
          throw new AccountLockedError(
            'The account is temporarily locked due to too many failed sign-in attempts.',
            { remainingLockMs: lock.remainingLockMs },
          );
        }
      }

      // The pure verifier never discloses which field was wrong (Req 1.3). It
      // is given a lookup returning the stored credential only for the resolved
      // User and the scrypt comparator.
      const result = verifyCredentials(
        credentials,
        (username) =>
          user != null && user.username === username
            ? { username: user.username, passwordHash: user.passwordHash }
            : null,
        verifyPassword,
      );

      if (!result.ok) {
        // Req 1.4: a missing/empty required field is a distinct 400.
        if (result.reason === 'missing_field') {
          throw new ValidationError(result.message, { field: result.field });
        }

        // Req 1.3 + 1.6: a genuine credential mismatch. Record the failed
        // attempt for an existing User and re-check the lock so the failure
        // that crosses the threshold surfaces as a 423.
        if (user != null) {
          await userRepository.recordFailedAttempt(user.id, now, tx);
          const relock = lockoutState([...user.failedAttempts, { at: now }], now);
          if (relock.locked) {
            throw new AccountLockedError(
              'The account is temporarily locked due to too many failed sign-in attempts.',
              { remainingLockMs: relock.remainingLockMs },
            );
          }
        }
        throw new AuthenticationError(result.message);
      }

      // Success: `user` is guaranteed present (verification matched a stored
      // credential). A role-less User cannot open a session (Req 2.5).
      const authenticated = user!;
      if (authenticated.role === null) {
        throw new AuthenticationError(
          'The credentials provided are not valid.',
        );
      }

      await userRepository.clearFailedAttempts(authenticated.id, tx);
      const session = await sessionRepository.create(
        {
          userId: authenticated.id,
          role: authenticated.role,
          lastActivityAt: now,
        },
        tx,
      );

      return {
        sessionId: session.id,
        user: toAuthUser(authenticated),
      };
    });
  }

  /**
   * Terminate a session (Req 1.5). Deleting a session that no longer exists is
   * a no-op, so a repeated sign-out is safe.
   */
  async signOut(sessionId: string): Promise<void> {
    await sessionRepository.delete(sessionId, this.db);
  }

  /**
   * Resolve the {@link AuthUser} for a session id, or `null` when the session
   * is unknown or its User can no longer be resolved. Does not apply the
   * sliding-expiry rule (that is the `authenticate` middleware's concern for
   * guarded routes); the auth router surfaces `null` as a 401.
   */
  async me(sessionId: string): Promise<AuthUser | null> {
    const session = await sessionRepository.findById(sessionId, this.db);
    if (session == null) {
      return null;
    }
    const user = await userRepository.findById(session.userId, this.db);
    if (user == null) {
      return null;
    }
    return toAuthUser(user);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shape a repository {@link User} into the {@link AuthUser} wire type. */
function toAuthUser(user: {
  id: string;
  username: string;
  role: Role | null;
  managedTeamIds: string[];
}): AuthUser {
  return {
    userId: user.id,
    username: user.username,
    role: user.role,
    managedTeamIds: user.managedTeamIds,
  };
}

/**
 * Convenience factory mirroring the pattern used by the other services: build
 * an {@link AuthService} bound to a {@link Database} handle.
 */
export function createAuthService(db: Database): AuthService {
  return new AuthService(db);
}
