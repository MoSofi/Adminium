/**
 * Application errors + the one non-2xx envelope (08-server-api.md §1.4).
 *
 * Every non-2xx response has the shape
 * `{ error: { code, message, requestId, details? } }` with a SCREAMING_SNAKE
 * `code` from the canonical table. Handlers throw `AppError` subclasses; the
 * global error handler in `app.ts` serializes them.
 */

/** Canonical error codes relevant to the M2 skeleton (08-server-api.md §1.4). */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'FORBIDDEN'
  | 'TABLE_FORBIDDEN'
  | 'COLUMN_FORBIDDEN'
  | 'PAGE_FORBIDDEN'
  | 'CSRF_FAILED'
  | 'READ_ONLY_MODE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNIQUE_VIOLATION'
  | 'FK_VIOLATION'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNKNOWN_IDENTIFIER'
  | 'RATE_LIMITED'
  | 'SOURCE_DB_UNREACHABLE'
  | 'INTERNAL';

/** The wire shape of every non-2xx response. */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/**
 * Builds the §1.4 envelope. `details` is included only when defined so
 * successful `JSON.stringify` output never carries a `"details": undefined`
 * hole (and `exactOptionalPropertyTypes` stays happy).
 */
export function errorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): ErrorEnvelope {
  return details === undefined
    ? { error: { code, message, requestId } }
    : { error: { code, message, requestId, details } };
}

/**
 * Base class for expected, route-throwable errors. Carries the HTTP status,
 * the SCREAMING_SNAKE code, and optional Zod-safe JSON `details`.
 */
export class AppError extends Error {
  override readonly name: string = 'AppError';
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** 404 — resource or record absent. */
export class NotFoundError extends AppError {
  override readonly name = 'NotFoundError';

  constructor(message = 'Resource not found.', details?: unknown) {
    super(404, 'NOT_FOUND', message, details);
  }
}

/** 422 — Zod schema rejection or semantically invalid input. */
export class ValidationFailedError extends AppError {
  override readonly name = 'ValidationFailedError';

  constructor(message = 'Request validation failed.', details?: unknown) {
    super(422, 'VALIDATION_FAILED', message, details);
  }
}

/** 401 — no/invalid session (`UNAUTHENTICATED`) or expired (`SESSION_EXPIRED`). */
export class UnauthorizedError extends AppError {
  override readonly name = 'UnauthorizedError';

  constructor(
    code: 'UNAUTHENTICATED' | 'SESSION_EXPIRED' = 'UNAUTHENTICATED',
    message = code === 'SESSION_EXPIRED' ? 'Your session has expired.' : 'Authentication required.',
    details?: unknown,
  ) {
    super(401, code, message, details);
  }
}

/** 403 — RBAC/CSRF denial; `code` narrows the flavor (08-server-api.md §1.4). */
export class ForbiddenError extends AppError {
  override readonly name = 'ForbiddenError';

  constructor(
    message = 'You do not have access to this resource.',
    code:
      | 'FORBIDDEN'
      | 'TABLE_FORBIDDEN'
      | 'COLUMN_FORBIDDEN'
      | 'PAGE_FORBIDDEN'
      | 'CSRF_FAILED'
      | 'READ_ONLY_MODE' = 'FORBIDDEN',
    details?: unknown,
  ) {
    super(403, code, message, details);
  }
}

/** 409 — optimistic-concurrency/state conflict or mapped constraint violation. */
export class ConflictError extends AppError {
  override readonly name = 'ConflictError';

  constructor(
    message = 'The resource changed since you loaded it.',
    code: 'CONFLICT' | 'UNIQUE_VIOLATION' | 'FK_VIOLATION' = 'CONFLICT',
    details?: unknown,
  ) {
    super(409, code, message, details);
  }
}

/**
 * 429 — thrown by the §6 limiter in `plugins/core.ts` when a bucket is
 * exhausted (08-server-api.md §6); the plugin sets `Retry-After` on the reply
 * before the global handler serializes this envelope. `details` carries
 * `{ bucket, limit, resetAt }` when known.
 */
export class RateLimitedError extends AppError {
  override readonly name = 'RateLimitedError';

  constructor(message = 'Too many requests. Try again shortly.', details?: unknown) {
    super(429, 'RATE_LIMITED', message, details);
  }
}
