/**
 * Minimal fetch client for `/api/v1` (08-server-api.md §1.4 envelope).
 * Cookie-session auth (same-origin); every non-2xx response is normalized to
 * an `ApiError` carrying the canonical `code`, HTTP status, and `requestId`
 * (the support handshake). Network-level failures surface as the browser's
 * `TypeError` and are mapped to the `offline` state by `stateIdForError`.
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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
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
