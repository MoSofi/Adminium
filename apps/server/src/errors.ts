// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Application errors + the one non-2xx envelope.
 *
 * Every non-2xx response has the shape
 * `{ error: { code, message, requestId, details? } }` with a SCREAMING_SNAKE
 * `code` from the canonical table. Handlers throw `AppError` subclasses; the
 * global error handler in `app.ts` serializes them.
 */

/** Canonical error codes relevant to the M2 skeleton. */
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
  | 'CAPACITY_FULL'
  | 'CAPACITY_BUSY'
  | 'CAPACITY_TOO_LATE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNKNOWN_IDENTIFIER'
  | 'RATE_LIMITED'
  | 'SOURCE_DB_UNREACHABLE'
  /**
   * The operator PAUSED this connection (meta wave 0019). 503 and not 403: the
   * caller did nothing wrong and nothing about them needs to change — the
   * source is administratively unavailable and will answer again when somebody
   * resumes it. Distinct from `SOURCE_DB_UNREACHABLE`, which reports a database
   * that failed to answer; this one never dialled.
   */
  | 'CONNECTION_DISABLED'
  // The two meta-store placement refusals. Both are
  // thrown by `connections/dsn.ts` subclasses and both were missing from this
  // union while already travelling the wire — `META_PLACEMENT_INVALID` has been
  // served by `POST /connections` since M3 and asserted by name in
  // `connections.test.ts`, so the canonical table here was simply out of date.
  | 'META_PLACEMENT_INVALID'
  | 'META_PREFIX_COLLISION'
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
 * Builds the envelope. `details` is included only when defined so
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

/** 403 — RBAC/CSRF denial; `code` narrows the flavor. */
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
      | 'READ_ONLY_MODE'
      // Someone whose every role opens only an app's own screens.
      | 'APP_SCREENS_ONLY' = 'FORBIDDEN',
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
    code:
      | 'CONFLICT'
      // A plain column the writer saw (`seen`) holds another value now.
      | 'ROW_CHANGED'
      | 'UNIQUE_VIOLATION'
      | 'FK_VIOLATION'
      // The booking guard: the slot has no room for this row, or another
      // writer held it for longer than a writer waits.
      | 'CAPACITY_FULL'
      | 'CAPACITY_BUSY'
      // A guest cancelling through the public API inside the venue's window.
      | 'CAPACITY_TOO_LATE'
      // Booking people: the person is already booked for part of that time,
      // they are away that day, or another writer held the day too long.
      | 'BOOKING_TAKEN'
      | 'BOOKING_CLOSED'
      | 'BOOKING_BUSY'
      // A guest cancelling (mode `refuse`) or moving a visit inside the
      // cancellation window: only the practice may now.
      | 'BOOKING_TOO_LATE'
      // A payment or a write-off larger than what is left to pay, or a lower
      // fee than what is already paid: a balance kept at zero or above.
      | 'BALANCE_EXCEEDED'
      // Two writers wanted the same rows at once and the database gave this
      // one up (a deadlock, a serialization failure, a busy SQLite file).
      // `details.retry` is true: the same write a moment later goes through.
      | 'WRITE_CONFLICT'
      // The plan was built against a schema that has since moved — either the
      // snapshot (another admin applied a plan) or the database itself
      // (somebody ran DDL outside Adminium). Both mean the same thing to the
      // caller: re-plan and look at it again.
      | 'SCHEMA_DRIFT'
      // A connection delete refused because publishable keys on its public
      // scopes are still live; `details.keys` names them (0014's restrict).
      | 'PUBLIC_KEYS_LIVE'
      // A key create named a generated endpoint that is no longer what the
      // page showed; `details.refs` names them.
      | 'PUBLIC_ENDPOINT_CHANGED'
      // An app install stopped part way; `details` says at which
      // stage and which tables exist. POSTing the same install resumes it.
      | 'APP_INSTALL_INCOMPLETE'
      // An app installed on one connection, asked to be installed on another:
      // `details` names the connection it is on.
      | 'APP_INSTALLED_ELSEWHERE'
      // A write naming the state a strict row already holds (a ticket let in
      // once): `details.at` and `details.by` say when and by whom it got there.
      | 'STATE_UNCHANGED'
      // A move a late rule turns away inside its window before a moment.
      | 'STATE_TOO_LATE'
      // A public change outside the window its entry opens (`details.bound`, `details.at`).
      | 'WRITE_WINDOW_CLOSED'
      // A price by the night whose rate rule cannot be read (`details.table`, `key`, `column`).
      | 'NIGHTLY_RATE_UNREADABLE'
      // More child rows follow the changed row than one write moves (`details.table`, `count`).
      | 'FOLLOW_TOO_MANY'
      // A desk's save came to another figure than the price it showed (`details.column`, `total`): nothing kept.
      | 'PRICE_CHANGED'
      // An add-on with tables, several databases, and none named: `details.connections` lists them.
      | 'ADD_ON_SCHEMA_CONNECTION'
      // An uninstall while something posts into the add-on: `details.postings`, `details.features`.
      | 'ADD_ON_IN_USE'
      // An add-on install or update stopped part way; `details.stage` says where. The same call resumes it.
      | 'ADD_ON_INSTALL_INCOMPLETE'
      | 'ADD_ON_UPDATE_INCOMPLETE'
      // A rule an app or an add-on ships is switched off or copied, never deleted.
      | 'AUTOMATION_MANAGED' = 'CONFLICT',
    details?: unknown,
  ) {
    super(409, code, message, details);
  }
}

/**
 * 503 — the connection is paused by an operator (meta wave 0019).
 *
 * Thrown by `ConnectionManager` before any dial, so it is the one connection
 * failure that costs the source database nothing. `Retry-After` is deliberately
 * NOT set: nobody knows when a human will resume it, and a made-up number turns
 * a deliberate pause into a promise.
 */
export class ConnectionDisabledError extends AppError {
  override readonly name = 'ConnectionDisabledError';

  constructor(connectionId: string, connectionName?: string) {
    super(
      503,
      'CONNECTION_DISABLED',
      connectionName === undefined
        ? 'This connection is paused. Resume it in Studio → Data connections to load data again.'
        : `The connection “${connectionName}” is paused. Resume it in Studio → Data connections to load data again.`,
      { connectionId },
    );
  }
}

/**
 * 503 — an installed app is switched off by an operator: the whole app
 * (`APP_DISABLED`) or one of its sides (`SURFACE_OFF`).
 *
 * Nothing is broken and nothing was deleted, so, like a paused connection, no
 * `Retry-After`: the answer changes when a person switches it back on.
 */
export class AppUnavailableError extends AppError {
  override readonly name = 'AppUnavailableError';

  constructor(appKey: string, reason: 'app-disabled' | 'side-off', side: 'staff' | 'customer') {
    super(
      503,
      reason === 'app-disabled' ? 'APP_DISABLED' : 'SURFACE_OFF',
      reason === 'app-disabled'
        ? `The app "${appKey}" is switched off. Switch it on again in Studio → Apps.`
        : `The ${side} screens of "${appKey}" are switched off. Switch them on again in Studio → Apps.`,
      { appKey, side },
    );
  }
}

/**
 * 429 — thrown by the limiter in `plugins/core.ts` when a bucket is
 * exhausted; the plugin sets `Retry-After` on the reply before the global
 * handler serializes this envelope. `details` carries `{ bucket, limit,
 * resetAt }` when known.
 */
export class RateLimitedError extends AppError {
  override readonly name = 'RateLimitedError';

  constructor(message = 'Too many requests. Try again shortly.', details?: unknown) {
    super(429, 'RATE_LIMITED', message, details);
  }
}

/**
 * Why a posting was refused, beyond what the ledger's own code says
 * (`out-of-stock`, `not-valid`, … — the add-on contract's reasons). These are
 * Adminium's own.
 */
export const POSTING_ENGINE_REASONS = [
  // The add-on's code threw, timed out, or answered outside what its ledger declares.
  'planner-failed',
  // More rows read or written than one posting may.
  'too-large',
  // The add-on is switched off, updating, without its files, or not one Adminium can vouch for.
  'add-on-unavailable',
  // The row's posting is still open: put it back first.
  'receipt-open',
  // A door that writes many rows at once cannot post: change the rows one at a time.
  'one-at-a-time',
  // Project code changes this table inside the save, so the posting cannot be planned ahead.
  'hooked',
  // A ledger table carries a booking guard or a number without gaps.
  'guarded',
  // A column the open posting read has changed.
  'mapped-changed',
  // A card may not pay for a card.
  'card-pays-card',
] as const;
export type PostingEngineReason = (typeof POSTING_ENGINE_REASONS)[number];

/**
 * 409 `POSTING_REFUSED`: a ledger refused what a row asked of it, or a
 * posting rule did. `details.reason` is one of the add-on contract's reasons
 * or one of `POSTING_ENGINE_REASONS`; `left` and `item` are told only to a
 * caller who may read the ledger's own tables.
 */
export class PostingRefusedError extends AppError {
  override readonly name = 'PostingRefusedError';

  constructor(
    message: string,
    details: {
      reason: string;
      ledger?: string;
      posting?: string;
      line?: number;
      path?: (string | number)[];
      left?: string;
      item?: string;
      rows?: number;
      table?: string;
      column?: string;
      phase?: 'reserve' | 'post' | 'reverse';
      /** Which public answer the ledger's own refusals become. */
      family?: 'stock' | 'value';
    },
  ) {
    super(409, 'POSTING_REFUSED', message, details);
  }
}

/**
 * 422 `ADD_ON_UNTRUSTED`: a package whose code would decide inside a save,
 * from a source Adminium cannot vouch for. It is stored and never run.
 */
export class AddOnUntrustedError extends AppError {
  override readonly name = 'AddOnUntrustedError';

  constructor(key: string, version: string) {
    super(
      422,
      'ADD_ON_UNTRUSTED',
      `"${key}" ${version} carries code that decides inside a save, and this package is neither one Adminium ships nor one from its catalogue. It is stored, and nothing of it runs.`,
      { key, version, stored: true },
    );
  }
}

/**
 * 409 `ADJUST_REFUSED`: a typed code, or a reduction staff gave by hand, was
 * refused in a staff save. `details.column` is where it was typed;
 * `details.reason` is one of the add-on contract's reasons or one of
 * Adminium's own (`frozen`, `not-allowed`, `refund-over`); `max`, `amount`
 * and `name` say what would be accepted, where the reason has one.
 */
export class AdjustRefusedError extends AppError {
  override readonly name = 'AdjustRefusedError';

  constructor(message: string, details: { column?: string; reason: string; max?: string; amount?: string; name?: string }) {
    super(409, 'ADJUST_REFUSED', message, details);
  }
}
