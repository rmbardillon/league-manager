/**
 * Core HTTP client for the Basketball League Management REST API.
 *
 * A thin, typed wrapper around `fetch` that:
 *   - sends `credentials: 'include'` so the HTTP-only session cookie set by
 *     `POST /auth/signin` rides along on every request (the SPA never handles
 *     the token directly);
 *   - serializes JSON request bodies and parses JSON responses;
 *   - maps the backend's structured error envelope
 *     `{ error: { category, message, details? } }` onto a typed {@link ApiError}
 *     so callers can branch on `category` (e.g. show a sign-in prompt on a
 *     401 AuthenticationError) without re-parsing the response.
 *
 * The base URL defaults to `/` (same origin, expecting a dev proxy or a
 * co-hosted API) and can be overridden with the `VITE_API_BASE_URL` env var.
 */
import type { ApiErrorResponse, ErrorCategory } from './types.js';

/** The base URL all requests are resolved against (no trailing slash). */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/**
 * A typed error thrown for any non-2xx response. Carries the parsed taxonomy
 * `category` and `message` from the backend envelope when present, plus the raw
 * HTTP status for cases where the body is not the expected shape.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly category: ErrorCategory | 'NetworkError' | 'UnknownError';
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    category: ErrorCategory | 'NetworkError' | 'UnknownError',
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.category = category;
    this.details = details;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** True when this error means the caller must (re-)authenticate. */
  get isUnauthenticated(): boolean {
    return this.status === 401 || this.category === 'AuthenticationError';
  }
}

/** Narrow an unknown parsed body to the API error envelope. */
function isErrorResponse(body: unknown): body is ApiErrorResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'object' &&
    (body as { error: unknown }).error !== null
  );
}

/** Supported HTTP verbs for {@link request}. */
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions {
  method?: Method;
  /** JSON-serializable request body. */
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Perform a request and return the parsed JSON body typed as `T`.
 *
 * A 204 (or any empty body) resolves to `undefined` cast to `T` so callers of
 * void endpoints (delete, sign-out) can `await` without a body. Any non-2xx
 * response — or a network failure — rejects with an {@link ApiError}.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: payload,
      credentials: 'include',
      signal,
    });
  } catch (cause) {
    // fetch rejects only on network failure / abort, never on HTTP status.
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }
    throw new ApiError(
      'Unable to reach the server. Check your connection and try again.',
      0,
      'NetworkError',
      cause,
    );
  }

  // Parse the body once. An empty body (204, or Content-Length 0) yields null.
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? safeJsonParse(text) : null;

  if (!response.ok) {
    if (isErrorResponse(parsed)) {
      throw new ApiError(
        parsed.error.message,
        response.status,
        parsed.error.category,
        parsed.error.details,
      );
    }
    throw new ApiError(
      `Request failed with status ${response.status}.`,
      response.status,
      'UnknownError',
      parsed,
    );
  }

  return (parsed ?? undefined) as T;
}

/** Parse JSON, returning the raw string on failure rather than throwing. */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
