/**
 * Central error-handling middleware for the API layer.
 *
 * Translates the structured domain/service error taxonomy into HTTP responses
 * with a consistent body. Every {@link DomainError} already carries both its
 * taxonomy `category` and the `httpStatus` the transport should emit, plus a
 * {@link DomainError.toResponse} serializer that produces the wire shape
 * `{ error: { category, message, details? } }`. This middleware is the single
 * place that maps those errors onto the Express response so controllers and
 * middleware only ever need to `throw`/`next(err)` a typed error.
 *
 * Status mapping (see the design's error taxonomy):
 *   - 401 AuthenticationError  — invalid/missing credentials or expired session
 *   - 403 AuthorizationError   — role/team access denied
 *   - 423 AccountLockedError   — account locked within the rolling lock window
 *   - plus every other DomainError via its own `httpStatus`
 *
 * Unknown (non-DomainError) failures are mapped to a generic 500 without
 * leaking internal details.
 *
 * _Requirements: 1.2, 1.6, 2.2, 2.3, 2.5_
 */
import type { NextFunction, Request, Response } from 'express';
import { DomainError, type ErrorResponse } from '../../domain/errors.js';

/** The generic body returned for unexpected, non-domain failures. */
const INTERNAL_ERROR_RESPONSE: ErrorResponse = {
  error: {
    // `ValidationError` is a client-facing category; for truly unexpected
    // failures we deliberately use a neutral category name and message so no
    // internal detail leaks. It is not one of the taxonomy categories on
    // purpose — the cast keeps the shared response shape.
    category: 'ValidationError',
    message: 'An unexpected error occurred.',
  } as ErrorResponse['error'],
};

/**
 * Express error-handling middleware. Must be registered LAST, after all routes,
 * and must keep the four-argument signature so Express recognizes it as an
 * error handler.
 *
 * A {@link DomainError} is serialized via {@link DomainError.toResponse} and
 * emitted with its declared {@link DomainError.httpStatus}. Any other value is
 * treated as an unexpected server error (500).
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // If a response has already started streaming, defer to Express' default
  // handler which will close the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof DomainError) {
    res.status(err.httpStatus).json(err.toResponse());
    return;
  }

  res.status(500).json(INTERNAL_ERROR_RESPONSE);
}
