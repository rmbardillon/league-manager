/**
 * Shared helpers for the mutating REST controllers (Task 19.3).
 *
 * These utilities keep each router free of repetitive transport plumbing:
 *
 *   - {@link asyncHandler} adapts an async controller into an Express handler
 *     that forwards any thrown error to `next(err)` so the central
 *     {@link errorHandler} performs the DomainError→HTTP mapping.
 *   - {@link param} normalizes an Express route parameter (`string | string[]`)
 *     down to the single string a `:id`-style segment always resolves to.
 *   - the body-reading helpers ({@link readString}, {@link readOptionalString},
 *     {@link readNumber}, {@link readOptionalNumber}, {@link readDate},
 *     {@link readBody}) turn an untyped JSON body into the typed values the
 *     services expect, raising a {@link ValidationError} for a malformed field
 *     so a bad request surfaces as a 400 rather than an unexpected 500.
 *
 * The API layer performs only shallow request parsing here; every business rule
 * (bounds, uniqueness, authorization, existence) lives in the services and the
 * pure domain, per the design's layer separation.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ValidationError } from '../../domain/errors.js';

/**
 * Wrap an async controller so a rejected promise is forwarded to Express'
 * error pipeline (and thus the central error handler) instead of crashing the
 * request. The controller writes the response itself on success.
 */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

/**
 * Collapse an Express path parameter to a single string. A `:id` segment always
 * resolves to a single value; the array case is never taken in practice but is
 * handled so the type is honored.
 */
export function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Treat a request body as a plain object, raising a 400 when it is not. */
export function readBody(req: Request): Record<string, unknown> {
  const body = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('A JSON object request body is required.', {
      field: 'body',
    });
  }
  return body as Record<string, unknown>;
}

/**
 * Read a required string field from a body, rejecting a missing or non-string
 * value with a 400 that names the field.
 */
export function readString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') {
    throw new ValidationError(`The field "${field}" must be a string.`, { field });
  }
  return value;
}

/**
 * Read an optional string field. Returns `undefined` when the field is absent
 * or explicitly `null`; rejects a present-but-non-string value.
 */
export function readOptionalString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ValidationError(`The field "${field}" must be a string.`, { field });
  }
  return value;
}

/**
 * Read a required numeric field, accepting a numeric string as a convenience so
 * a JSON `"12"` and `12` both parse. Rejects a value that is not a finite
 * number.
 */
export function readNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  throw new ValidationError(`The field "${field}" must be a number.`, { field });
}

/** Read an optional numeric field; returns `undefined` when absent/null. */
export function readOptionalNumber(
  body: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  return readNumber(body, field);
}

/**
 * Read a required date field from an ISO date/date-time string (or an epoch
 * millisecond number), rejecting a value that does not parse to a valid Date.
 */
export function readDate(body: Record<string, unknown>, field: string): Date {
  const value = body[field];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ValidationError(`The field "${field}" must be an ISO date string.`, {
      field,
    });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`The field "${field}" is not a valid date.`, { field });
  }
  return date;
}
