/**
 * Authentication endpoints (Requirement 1).
 *
 * The three transport routes the SPA's `authApi` targets, over the
 * {@link AuthService}:
 *
 *   - POST /auth/signin  — verify credentials, open a session, and set the
 *                          HTTP-only `session` cookie. 200 with the
 *                          {@link AuthUser}; 401 for invalid credentials
 *                          (generic message, Req 1.3); 423 for a locked
 *                          account (Req 1.6); 400 for a missing field (Req 1.4).
 *   - POST /auth/signout — terminate the session named by the cookie and clear
 *                          it. 204 (Req 1.5).
 *   - GET  /auth/me      — resolve the principal from the session cookie; 200
 *                          with the {@link AuthUser}, or 401 when there is no
 *                          valid session.
 *
 * The session id travels in an HTTP-only, SameSite=Lax cookie so browser
 * JavaScript cannot read it and it is not sent on cross-site navigations; it is
 * marked `Secure` in production so it only rides HTTPS. The cookie's `Max-Age`
 * tracks the sliding inactivity window (Req 1.2). Errors are forwarded to the
 * central {@link errorHandler} via {@link asyncHandler}.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
 */
import { Router, type Request, type CookieOptions } from 'express';
import { SESSION_INACTIVITY_MS } from '../../domain/auth.js';
import { AuthenticationError } from '../../domain/errors.js';
import { db } from '../../db/client.js';
import { AuthService } from '../../services/authService.js';
import { SESSION_COOKIE_NAME } from '../middleware/auth.js';
import { asyncHandler, readBody, readString } from './helpers.js';

/**
 * Cookie attributes for the session cookie. `secure` is enabled outside
 * development so the cookie is only sent over HTTPS in production while local
 * HTTP development still works.
 */
function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_INACTIVITY_MS,
  };
}

/**
 * Read the session id from the request's `session` cookie without pulling in a
 * cookie-parsing dependency (Express does not parse cookies by default).
 * Returns the decoded value or `null`.
 */
function readSessionCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/** Build the authentication router. */
export function createAuthRouter(): Router {
  const router = Router();
  const service = new AuthService(db);

  router.post(
    '/signin',
    asyncHandler(async (req, res) => {
      const body = readBody(req);
      const username = readString(body, 'username');
      const password = readString(body, 'password');

      const { sessionId, user } = await service.signIn({ username, password });

      res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions());
      res.status(200).json(user);
    }),
  );

  router.post(
    '/signout',
    asyncHandler(async (req, res) => {
      const sessionId = readSessionCookie(req);
      if (sessionId != null) {
        await service.signOut(sessionId);
      }
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      res.status(204).end();
    }),
  );

  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const sessionId = readSessionCookie(req);
      const user = sessionId == null ? null : await service.me(sessionId);
      if (user == null) {
        throw new AuthenticationError('Authentication is required.');
      }
      res.status(200).json(user);
    }),
  );

  return router;
}
