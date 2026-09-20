/**
 * Authentication + Authorization middleware for the API layer.
 *
 * These Express middlewares sit between the transport (routes) and the
 * application services, implementing the request flow from the design's
 * sequence diagram: verify the session, then enforce role/team access, before
 * any service is reached. Failures are surfaced as typed {@link DomainError}s
 * (via `next(err)`) so the central error handler maps them to the correct HTTP
 * status:
 *   - 401 {@link AuthenticationError}  — missing/invalid/expired session (Req 1.2)
 *   - 403 {@link AuthorizationError}   — role/team access denied (Req 2.2–2.5)
 *   - 423 {@link AccountLockedError}   — locked account (surfaced by services)
 *
 * The authentication step uses the pure {@link sessionState} evaluator for the
 * sliding 30-minute inactivity rule (Req 1.2, 1.5) and, on success, refreshes
 * the session's `lastActivityAt` (sliding expiry) before attaching the
 * resolved {@link AuthUser} to the request. The authorization step delegates
 * the decision entirely to the pure {@link authorize} function (Req 2.1–2.5).
 *
 * _Requirements: 1.1, 1.2, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5_
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { sessionState } from '../../domain/auth.js';
import { authorize, type Action, type AuthUser, type ResourceRef } from '../../domain/authorize.js';
import { AuthenticationError, AuthorizationError } from '../../domain/errors.js';
import { db } from '../../db/client.js';
import { sessionRepository, userRepository } from '../../repositories/index.js';
import type { Database } from '../../repositories/executor.js';

/** Name of the HTTP-only cookie carrying the server-side session id. */
export const SESSION_COOKIE_NAME = 'session';

/**
 * The authentication context attached to a request once its session has been
 * validated. Available on `req.auth` inside authorization middleware and
 * controllers.
 */
export interface AuthContext {
  /** The validated session id (the value that was presented by the client). */
  readonly sessionId: string;
  /** The authenticated principal used for authorization decisions. */
  readonly user: AuthUser;
}

// Augment Express' Request so `req.auth` is typed across the app.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Resolves the {@link ResourceRef} an authorization decision is made against
 * from the incoming request (e.g. the owning Team id from route params/body).
 */
export type ResourceResolver = (req: Request) => ResourceRef;

/** Dependencies the middleware factories rely on; overridable in tests. */
export interface AuthMiddlewareDeps {
  readonly db: Database;
  readonly now: () => Date;
}

const defaultDeps: AuthMiddlewareDeps = {
  db,
  now: () => new Date(),
};

/**
 * Extract the session id from the request: prefer the HTTP-only session cookie,
 * then fall back to a bearer token in the `Authorization` header. Returns
 * `null` when neither is present.
 */
function readSessionId(req: Request): string | null {
  const fromCookie = readCookie(req, SESSION_COOKIE_NAME);
  if (fromCookie != null && fromCookie.length > 0) {
    return fromCookie;
  }

  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Parse a single cookie value out of the raw `Cookie` header without pulling in
 * a cookie-parsing dependency. Returns the decoded value or `null`.
 */
function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    if (key === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

/**
 * Authentication middleware: validate the presented session and attach the
 * authenticated principal to `req.auth`.
 *
 * On success the session's `lastActivityAt` is refreshed (sliding 30-minute
 * expiry, Req 1.2) and `req.auth` is populated. Any failure — no session,
 * unknown/expired/signed-out session, or a session whose User can no longer be
 * resolved — is forwarded as a 401 {@link AuthenticationError} (Req 1.2, 1.5).
 *
 * @param overrides Optional dependency overrides (database handle, clock).
 */
export function authenticate(overrides?: Partial<AuthMiddlewareDeps>): RequestHandler {
  const deps: AuthMiddlewareDeps = { ...defaultDeps, ...overrides };

  return (req: Request, _res: Response, next: NextFunction): void => {
    void authenticateRequest(req, deps)
      .then(() => next())
      .catch(next);
  };
}

async function authenticateRequest(req: Request, deps: AuthMiddlewareDeps): Promise<void> {
  const sessionId = readSessionId(req);
  if (sessionId == null) {
    throw new AuthenticationError('Authentication is required.');
  }

  const now = deps.now();
  const session = await sessionRepository.findById(sessionId, deps.db);

  // The pure evaluator applies the sliding 30-minute inactivity rule and
  // treats a missing session as `no_session` (Req 1.2, 1.5). A signed-out
  // session is removed from the store, so it also reads as `no_session`.
  const state = sessionState(session, now);
  if (!state.active) {
    throw new AuthenticationError('The session is invalid or has expired.');
  }

  // Session is guaranteed non-null here because `active` implies it existed.
  const validSession = session!;

  const user = await userRepository.findById(validSession.userId, deps.db);
  if (user == null) {
    throw new AuthenticationError('The session is invalid or has expired.');
  }

  // Refresh the sliding inactivity window on every authenticated request.
  await sessionRepository.touch(validSession.id, now, deps.db);

  req.auth = {
    sessionId: validSession.id,
    user: {
      id: user.id,
      role: user.role,
      managedTeamIds: user.managedTeamIds,
    },
  };
}

/**
 * Authorization middleware factory. Given the governed `action` and a resolver
 * that derives the target {@link ResourceRef} from the request, it evaluates
 * the pure {@link authorize} decision against the authenticated principal and
 * either continues or forwards a 403 {@link AuthorizationError} (Req 2.2–2.5).
 *
 * Must run after {@link authenticate}; if `req.auth` is absent the request is
 * rejected as unauthenticated (401) rather than silently allowed.
 *
 * A User with no primary role is denied every operation by {@link authorize}
 * (Req 2.5).
 */
export function authorizeRequest(action: Action, resource: ResourceResolver): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (auth == null) {
      next(new AuthenticationError('Authentication is required.'));
      return;
    }

    const decision = authorize(auth.user, action, resource(req));
    if (!decision.allowed) {
      next(new AuthorizationError(decision.reason));
      return;
    }

    next();
  };
}
