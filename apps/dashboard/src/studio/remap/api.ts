// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Remap editor API client:
 *
 * - `GET  /connections/:id/schema`     — snapshot with overrides APPLIED
 *   (the live-preview read path — labels here are the effective ones),
 * - `GET  /connections/:id/overrides`  — persisted override rows,
 * - `PUT  /connections/:id/overrides`  — full-document replace,
 * - `POST /connections/:id/generate`   — regeneration with counts.
 *
 * `putJson` locally replicates the `app/api.ts` envelope handling because
 * that client has no `put` yet and apps/dashboard/src/app is outside this
 * feature's paths this wave — fold into `api.put` once the owner adds it.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, ApiError, csrfHeaders } from '../../app/api.js';
import type { GenerateReply, SchemaReply } from './model.js';
import type { OverrideDto, OverridesPutDocument } from './overrides.js';

export interface OverridesReply {
  overrides: OverrideDto[];
}

async function putJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PUT',
    credentials: 'same-origin',
    // Hand-rolled fetch ⇒ hand-rolled CSRF header (08 §7 item 4). Without it
    // every schema-override save 403s.
    headers: { accept: 'application/json', 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Empty or non-JSON body — leave null.
  }
  if (!response.ok) {
    const envelope = (body ?? {}) as {
      error?: { code?: unknown; message?: unknown; requestId?: unknown; details?: unknown };
    };
    throw new ApiError(
      response.status,
      typeof envelope.error?.code === 'string' ? envelope.error.code : 'INTERNAL',
      typeof envelope.error?.message === 'string'
        ? envelope.error.message
        : `Request failed with status ${response.status}.`,
      typeof envelope.error?.requestId === 'string'
        ? envelope.error.requestId
        : (response.headers.get('x-request-id') ?? null),
      envelope.error?.details,
    );
  }
  return body as T;
}

const base = (connectionId: string): string => `/api/v1/connections/${encodeURIComponent(connectionId)}`;

export function remapSchemaQuery(connectionId: string) {
  return queryOptions({
    queryKey: ['studio', 'remap', 'schema', connectionId] as const,
    queryFn: () => api.get<SchemaReply>(`${base(connectionId)}/schema`),
  });
}

export function remapOverridesQuery(connectionId: string) {
  return queryOptions({
    queryKey: ['studio', 'remap', 'overrides', connectionId] as const,
    queryFn: () => api.get<OverridesReply>(`${base(connectionId)}/overrides`),
  });
}

export function putOverrides(connectionId: string, document: OverridesPutDocument): Promise<OverridesReply> {
  return putJson<OverridesReply>(`${base(connectionId)}/overrides`, document);
}

export function regeneratePages(connectionId: string): Promise<GenerateReply> {
  return api.post<GenerateReply>(`${base(connectionId)}/generate`);
}
