/**
 * Pure domain logic for the Authentication_Service (Requirement 1).
 *
 * These functions are I/O-free and deterministic so they can be exercised as
 * universal properties (Properties 2–4) without a database, clock, or HTTP.
 * The surrounding service layer is responsible for reading/writing sessions
 * and users; this module only decides *state* from the data it is given.
 *
 * _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_
 */

import type { Session } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sliding session inactivity window: 30 minutes, in milliseconds (Req 1.2). */
export const SESSION_INACTIVITY_MS = 30 * 60 * 1000;

/** Rolling failed-attempt window: 15 minutes, in milliseconds (Req 1.6). */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/** Lock duration once the account is locked: 15 minutes, in ms (Req 1.6). */
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * Maximum tolerated failures within the rolling window. The account locks when
 * failures *exceed* this count ("more than 5" — Req 1.6), i.e. the 6th failure
 * within the window triggers the lock.
 */
export const MAX_FAILED_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Session state (Req 1.2, 1.5)
// ---------------------------------------------------------------------------

/**
 * Result of evaluating a session against the current time.
 *
 * `active` is true iff the session exists, has not been signed out, and the
 * elapsed time since `lastActivityAt` is strictly less than 30 minutes.
 */
export type SessionState =
  | { active: true }
  | { active: false; reason: 'expired' | 'signed_out' | 'no_session' };

/**
 * A session that carries an explicit sign-out marker. The pure evaluator does
 * not mutate anything; the service records the sign-out and passes it here.
 */
export interface EvaluatableSession extends Session {
  /** Set when the User has signed out (Req 1.5). Absent/false → still open. */
  signedOut?: boolean;
}

/**
 * Determine whether a session is currently active (Req 1.2, 1.5).
 *
 * A session is active if and only if:
 *  - a session is present, AND
 *  - it has not been signed out, AND
 *  - the elapsed time since `lastActivityAt` is strictly less than 30 minutes
 *    (sliding inactivity expiry).
 *
 * Exactly at the 30-minute boundary the session is considered expired, since
 * the rule requires the elapsed time to be *strictly less than* 30 minutes.
 *
 * @param session The session to evaluate, or `null`/`undefined` if none exists.
 * @param now     The current time used to measure inactivity.
 */
export function sessionState(
  session: EvaluatableSession | null | undefined,
  now: Date,
): SessionState {
  if (session == null) {
    return { active: false, reason: 'no_session' };
  }

  if (session.signedOut === true) {
    return { active: false, reason: 'signed_out' };
  }

  const elapsedMs = now.getTime() - session.lastActivityAt.getTime();
  if (elapsedMs < SESSION_INACTIVITY_MS) {
    return { active: true };
  }

  return { active: false, reason: 'expired' };
}

// ---------------------------------------------------------------------------
// Lockout state (Req 1.6)
// ---------------------------------------------------------------------------

/** A single timestamped failed sign-in attempt. */
export interface FailedAttempt {
  at: Date;
}

/**
 * Result of evaluating account lockout against the current time.
 *
 * When locked, `remainingLockMs` reports how much of the 15-minute lock period
 * is left, so the caller can surface the remaining duration (Req 1.6).
 */
export type LockoutState =
  | { locked: false }
  | { locked: true; remainingLockMs: number };

/**
 * Determine whether an account is locked based on its recent failed attempts
 * (Req 1.6).
 *
 * The account is locked at `now` if and only if more than 5 failed attempts
 * fall within the preceding rolling 15-minute window. When that threshold is
 * exceeded, the lock lasts 15 minutes measured from the most recent failure
 * that pushed the count over the limit (the 6th-and-later failures inside the
 * window). While locked, callers must reject every sign-in attempt.
 *
 * The window is inclusive of its lower bound: an attempt whose timestamp is
 * exactly `now - 15 minutes` still counts as being within the window.
 *
 * @param failedAttempts Timestamped failed sign-in attempts (any order).
 * @param now            The current time.
 */
export function lockoutState(
  failedAttempts: readonly FailedAttempt[],
  now: Date,
): LockoutState {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - LOCKOUT_WINDOW_MS;

  // Failures within the preceding rolling window, oldest → newest.
  const withinWindow = failedAttempts
    .map((attempt) => attempt.at.getTime())
    .filter((atMs) => atMs >= windowStartMs && atMs <= nowMs)
    .sort((a, b) => a - b);

  if (withinWindow.length <= MAX_FAILED_ATTEMPTS) {
    return { locked: false };
  }

  // The lock is triggered by the attempt that first exceeds the threshold
  // (the 6th within the window). The lock runs 15 minutes from that trigger.
  const triggerMs = withinWindow[MAX_FAILED_ATTEMPTS];
  const lockExpiresMs = triggerMs + LOCKOUT_DURATION_MS;
  const remainingLockMs = lockExpiresMs - nowMs;

  if (remainingLockMs <= 0) {
    return { locked: false };
  }

  return { locked: true, remainingLockMs };
}

// ---------------------------------------------------------------------------
// Credential verification result shape (Req 1.3, 1.4)
// ---------------------------------------------------------------------------

/**
 * Result of verifying submitted sign-in credentials.
 *
 * On failure the shape deliberately does NOT disclose whether the username or
 * the password was the mismatched field: an unknown username and a wrong
 * password both yield the same `invalid_credentials` reason and message
 * (Req 1.3). The one exception is a request that omits a required field, which
 * is reported distinctly and may name the missing field (Req 1.4).
 */
export type VerifyCredentialsResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_credentials'; message: string }
  | {
      ok: false;
      reason: 'missing_field';
      message: string;
      /** Which required field was empty (Req 1.4). */
      field: 'username' | 'password';
    };

/** Generic, non-disclosing message returned for any credential mismatch. */
export const INVALID_CREDENTIALS_MESSAGE =
  'The credentials provided are not valid.';

/**
 * A minimal, hashing-agnostic view of a stored user needed to verify a
 * credential pair. The service supplies the stored hash; this pure function
 * defers the actual hash comparison to an injected comparator so it stays
 * I/O-free and deterministic under test.
 */
export interface StoredCredential {
  username: string;
  passwordHash: string;
}

/**
 * Verify submitted credentials without disclosing which field was wrong
 * (Req 1.3, 1.4).
 *
 * Order of checks:
 *  1. If either required field is empty/whitespace, report `missing_field`
 *     naming the offending field (Req 1.4).
 *  2. Otherwise, look up the stored user and compare the password. A missing
 *     user OR a non-matching password both yield the identical
 *     `invalid_credentials` result, so the response cannot be used to probe
 *     which usernames exist (Req 1.3).
 *
 * @param submitted  The username/password pair submitted by the user.
 * @param lookup     Resolves a stored credential by username, or `undefined`.
 * @param comparePassword Compares a plaintext password to a stored hash.
 */
export function verifyCredentials(
  submitted: { username: string; password: string },
  lookup: (username: string) => StoredCredential | null | undefined,
  comparePassword: (password: string, passwordHash: string) => boolean,
): VerifyCredentialsResult {
  const usernameProvided = submitted.username.trim().length > 0;
  const passwordProvided = submitted.password.length > 0;

  if (!usernameProvided) {
    return {
      ok: false,
      reason: 'missing_field',
      field: 'username',
      message: 'The username field is required.',
    };
  }

  if (!passwordProvided) {
    return {
      ok: false,
      reason: 'missing_field',
      field: 'password',
      message: 'The password field is required.',
    };
  }

  const stored = lookup(submitted.username);

  // Non-disclosing failure: identical result whether the username is unknown
  // or the password does not match (Req 1.3).
  const invalid: VerifyCredentialsResult = {
    ok: false,
    reason: 'invalid_credentials',
    message: INVALID_CREDENTIALS_MESSAGE,
  };

  if (stored == null) {
    return invalid;
  }

  if (!comparePassword(submitted.password, stored.passwordHash)) {
    return invalid;
  }

  return { ok: true };
}
