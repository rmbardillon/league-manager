/**
 * Structured error taxonomy for the Basketball League Management System.
 *
 * These classes mirror the "Error Handling" section of the design document.
 * Every domain/service failure is expressed as one of these typed errors so
 * that the API layer can map them to a consistent HTTP status code and the
 * consistent response shape `{ error: { category, message, details? } }`.
 *
 * Each error carries:
 *   - `category`   — the taxonomy category (also its class name).
 *   - `message`    — a human-readable description.
 *   - `httpStatus` — the HTTP status code the API layer should emit.
 *   - `details`    — optional structured payload for field-level feedback.
 *
 * _Requirements: 2.2, 2.3, 3.2, 5.5, 11.3, 12.18_
 */

// ---------------------------------------------------------------------------
// Category taxonomy
// ---------------------------------------------------------------------------

/**
 * The taxonomy categories. Each value equals the corresponding error class
 * name and is surfaced in the structured error response.
 */
export type ErrorCategory =
  | 'ValidationError'
  | 'AuthenticationError'
  | 'AccountLockedError'
  | 'AuthorizationError'
  | 'NotFoundError'
  | 'ConflictError'
  | 'ConstraintError'
  | 'CapacityError'
  | 'BatchValidationError';

/** Runtime tuple of all {@link ErrorCategory} values. */
export const ErrorCategories = [
  'ValidationError',
  'AuthenticationError',
  'AccountLockedError',
  'AuthorizationError',
  'NotFoundError',
  'ConflictError',
  'ConstraintError',
  'CapacityError',
  'BatchValidationError',
] as const satisfies readonly ErrorCategory[];

/**
 * The consistent wire shape produced by {@link DomainError.toResponse}.
 * `details` is omitted entirely when no structured payload is present.
 */
export interface ErrorResponse {
  error: {
    category: ErrorCategory;
    message: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

/**
 * Base class for every structured domain error. Not thrown directly — use one
 * of the concrete subclasses so the correct `category`/`httpStatus` pair is
 * carried automatically.
 */
export abstract class DomainError extends Error {
  /** Taxonomy category; equals the concrete class name. */
  abstract readonly category: ErrorCategory;
  /** HTTP status the API layer should emit for this category. */
  abstract readonly httpStatus: number;
  /** Optional structured payload (e.g. offending field, per-row report). */
  readonly details?: unknown;

  protected constructor(message: string, details?: unknown) {
    super(message);
    // Preserve the concrete class name on the built-in `name` field and fix
    // the prototype chain so `instanceof` works when compiled to ES targets.
    this.name = new.target.name;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serialize to the consistent response shape
   * `{ error: { category, message, details? } }`. `details` is included only
   * when it was provided.
   */
  toResponse(): ErrorResponse {
    const error: ErrorResponse['error'] = {
      category: this.category,
      message: this.message,
    };
    if (this.details !== undefined) {
      error.details = this.details;
    }
    return { error };
  }
}

// ---------------------------------------------------------------------------
// Concrete errors (one per taxonomy category)
// ---------------------------------------------------------------------------

/**
 * 400 — Invalid input: bad name length, out-of-range jersey/score/statistic,
 * past date, identical teams, missing field, invalid format/best-of-N
 * (Req 3.2, 4.3, 5.2–5.4, 6.2, 8.3, 9.2–9.5, 9.11).
 */
export class ValidationError extends DomainError {
  readonly category = 'ValidationError';
  readonly httpStatus = 400;
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * 401 — Invalid/missing credentials or expired session. The message stays
 * generic for sign-in failures to avoid disclosing which field was wrong
 * (Req 1.2, 1.3, 1.4).
 */
export class AuthenticationError extends DomainError {
  readonly category = 'AuthenticationError';
  readonly httpStatus = 401;
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * 423 — Account locked within the 15-minute rolling lock window (Req 1.6).
 */
export class AccountLockedError extends DomainError {
  readonly category = 'AccountLockedError';
  readonly httpStatus = 423;
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * 403 — Viewer mutation, Team_Manager acting on an unassigned Team, no role,
 * or non-admin schedule generation (Req 2.2, 2.3, 2.5, 4.4, 12.1).
 */
export class AuthorizationError extends DomainError {
  readonly category = 'AuthorizationError';
  readonly httpStatus = 403;
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * 404 — Unknown Season, Team, Player, or Game identifier
 * (Req 3.3, 3.6, 4.6).
 */
export class NotFoundError extends DomainError {
  readonly category = 'NotFoundError';
  readonly httpStatus = 404;
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * 409 — Duplicate Team/Season name, duplicate jersey number, or venue
 * interval overlap (Req 3.4, 4.2, 5.5, 9.3).
 */
export class ConflictError extends DomainError {
  readonly category = 'ConflictError';
  readonly httpStatus = 409;
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * 409 — State constraint violated: delete Team with completed Games,
 * reschedule a cancelled Game, initial score on a completed Game, or create a
 * Game in a closed Season (Req 3.8, 5.7, 6.5, 9.13).
 */
export class ConstraintError extends DomainError {
  readonly category = 'ConstraintError';
  readonly httpStatus = 409;
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * 422 — Schedule generation cannot place all required matchups; carries the
 * unplaced matchups in `details` (Req 12.18).
 */
export class CapacityError extends DomainError {
  readonly category = 'CapacityError';
  readonly httpStatus = 422;
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/**
 * 422 — Batch upload failure: any invalid row, unsupported format, or empty
 * file. All-or-nothing; carries the per-row report in `details`
 * (Req 11.3, 11.5, 11.6).
 */
export class BatchValidationError extends DomainError {
  readonly category = 'BatchValidationError';
  readonly httpStatus = 422;
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}
