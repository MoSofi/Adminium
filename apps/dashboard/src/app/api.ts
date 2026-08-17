// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Minimal fetch client for `/api/v1` (08-server-api.md §1.4 envelope).
 * Cookie-session auth (same-origin); every non-2xx response is normalized to
 * an `ApiError` carrying the canonical `code`, HTTP status, and `requestId`
 * (the support handshake). Network-level failures surface as the browser's
 * `TypeError` and are mapped to the `offline` state by `stateIdForError`.
 *
 * CSRF (08-server-api.md §7 item 4): every mutating call carries the
 * session-bound token `GET /bootstrap` issued, in `x-adminium-csrf`. The token
 * lives in a module-level holder rather than React state because FOUR of the
 * five mutating fetch call sites in this app do not go through `api` at all —
 * `studio/api.ts` (deleteJson), `studio/remap/api.ts` (putJson),
 * `app/branding.ts` (raw image bytes) and `data-io/api.ts` (raw text/csv) all
 * hand-roll `fetch` because this client is JSON-only. They import
 * {@link csrfHeaders} from here; patching only this file would ship a
 * dashboard that 403s on schema-override saves, logo uploads, CSV imports and
 * the delete-connection confirm. `app/bootstrap.ts` is the only writer.
 */

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  /** SCREAMING_SNAKE canonical code, e.g. `SESSION_EXPIRED`. */
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, requestId: string | null, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error?: { code?: unknown; message?: unknown; requestId?: unknown; details?: unknown };
}

/** The header `security/csrf.ts` reads the token out of. */
export const CSRF_HEADER = 'x-adminium-csrf';

let csrfToken: string | null = null;

/** Called by the bootstrap query with the token the server just issued. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/**
 * Headers to merge into any mutating request. Empty before `/bootstrap`
 * resolves.
 *
 * That is safe today for ONE structural reason, which is worth naming because
 * it is the thing a refactor can quietly remove: `app/router.tsx`'s `appRoute`
 * awaits `ensureQueryData(bootstrapQuery())` in `beforeLoad`, and the query fn
 * calls {@link setCsrfToken} before it resolves — so no authed surface is
 * mounted, and no authed mutation is reachable, until the token is here. The
 * pre-auth screens (`/login`, `/setup`, `/forgot`, `/reset`) do mutate with an
 * empty holder and are fine for a different reason: they carry no session, and
 * a session is the ambient credential the server's check exists to protect
 * (`security/csrf.ts` skips sessionless requests).
 *
 * What is NOT true — the earlier version of this comment claimed it — is that
 * a missing token would surface as "a clean 403 rather than a silent no-op".
 * At least one call site swallows it: the root `onPrefChange` catches and
 * discards a failed `PATCH /me/prefs` so a pref write cannot crash the app,
 * which means a tokenless (or 429'd, or otherwise refused) write disappears
 * with the axis still applied locally. So if the invariant above is ever
 * broken, the symptom will be a preference that silently does not persist —
 * not a visible error. Move a mutation earlier than `appRoute` and this holder
 * needs to become awaitable (a shared in-flight promise) first.
 */
export function csrfHeaders(): Record<string, string> {
  return csrfToken === null ? {} : { [CSRF_HEADER]: csrfToken };
}

/** GET/HEAD are never checked server-side, so they never carry the token. */
function isMutating(method: string | undefined): boolean {
  const verb = (method ?? 'GET').toUpperCase();
  return verb !== 'GET' && verb !== 'HEAD';
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(isMutating(init?.method) ? csrfHeaders() : {}),
      ...init?.headers,
    },
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Empty or non-JSON body (204, proxies) — leave null.
  }

  if (!response.ok) {
    const envelope = (body ?? {}) as ErrorEnvelope;
    const code = typeof envelope.error?.code === 'string' ? envelope.error.code : 'INTERNAL';
    const message =
      typeof envelope.error?.message === 'string'
        ? envelope.error.message
        : `Request failed with status ${response.status}.`;
    const requestId =
      typeof envelope.error?.requestId === 'string'
        ? envelope.error.requestId
        : (response.headers.get('x-request-id') ?? null);
    throw new ApiError(response.status, code, message, requestId, envelope.error?.details);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, payload?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  put: <T>(path: string, payload: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: JSON.stringify(payload) }),
  patch: <T>(path: string, payload: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(payload) }),
  delete: <T>(path: string, payload?: unknown) =>
    apiFetch<T>(path, {
      method: 'DELETE',
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
};
