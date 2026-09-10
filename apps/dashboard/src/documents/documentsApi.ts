// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/api/v1/documents` client (34-invoices-add-on.md §7.5, §7.8).
 *
 * ─── `installed` IS A QUERY, NOT A BUILD FLAG ──────────────────────────────
 *
 * Every surface that shows documents asks first, because whether a deployment
 * can draw one depends on what is INSTALLED — and an add-on can be installed
 * or removed while somebody has the page open. `GET /documents/providers`
 * answers `{installed: false}` rather than 404ing, so a build with no provider
 * is a quiet no rather than an error somebody has to interpret.
 *
 * ─── A REDACTED ROW IS STILL A ROW ─────────────────────────────────────────
 *
 * `subject` comes back null when the caller may not read every table the
 * document's mapping uses. The panel shows the row anyway — three invoices
 * exist for this order and you may not read them is useful and true, and
 * hiding them would make the page lie.
 */

import { api } from '../app/api.js';

const BASE = '/api/v1/documents';

export interface DocumentRow {
  id: string;
  profileId: string | null;
  addOnKey: string;
  kind: string;
  connectionId: string | null;
  entityTable: string | null;
  entityId: string | null;
  subject: unknown;
  number: string | null;
  locale: string;
  format: string;
  status: string;
  error: string | null;
  delivery: string | null;
  renderedAt: number | null;
  voidedAt: number | null;
  voidReason: string | null;
  createdAt: number;
  redacted: boolean;
  hasContent: boolean;
}

export interface DocumentProfileSummary {
  id: string;
  addOnKey: string;
  kind: string;
  name: string;
  connectionId: string;
  table: string;
  enabled: boolean;
}

export async function fetchDocumentProviders(): Promise<{
  installed: boolean;
  addOnKeys: string[];
}> {
  return await api.get(`${BASE}/providers`);
}

export async function fetchDocumentsForEntity(input: {
  entityTable: string;
  entityId: string;
}): Promise<DocumentRow[]> {
  const query = new URLSearchParams({
    entityTable: input.entityTable,
    entityId: input.entityId,
  });
  const reply = await api.get<{ documents: DocumentRow[] }>(`${BASE}?${query.toString()}`);
  return reply.documents;
}

/**
 * The mappings that can draw a document from THIS table.
 *
 * Filtered client-side from the profiles list, because the server's filter is
 * by connection and add-on — the table is what a record page knows, and adding
 * a third query parameter for one caller is a route that grows a parameter per
 * screen.
 */
export async function fetchProfilesForTable(input: {
  connectionId: string;
  table: string;
}): Promise<DocumentProfileSummary[]> {
  const query = new URLSearchParams({ connectionId: input.connectionId });
  const reply = await api.get<{ profiles: DocumentProfileSummary[] }>(
    `${BASE}/profiles?${query.toString()}`,
  );
  return reply.profiles.filter((profile) => profile.table === input.table && profile.enabled);
}

export async function renderDocumentFor(input: {
  profileId: string;
  pk: Record<string, unknown>;
}): Promise<{ jobId: string }> {
  return await api.post(`${BASE}/render`, input);
}

/**
 * The register's key for a source row — `entityKeyOf` in
 * `packages/meta/src/repos/documents.ts`, restated for the caller's side.
 *
 * SORTED BY KEY and joined with `|`, because `jsonb` reorders object keys on
 * PostgreSQL and MySQL: a composite key written on one dialect would not match
 * the same row's key read on another. The server imposes the order for that
 * reason and a caller that builds the key itself has to impose the same one.
 *
 * Restated rather than imported because the dashboard does not depend on
 * `@adminium/meta` — the server's own tests pin the format, and this file's
 * test pins that these two agree.
 */
export function entityKey(pk: Readonly<Record<string, unknown>>): string {
  return Object.keys(pk)
    .sort()
    .map((column) => `${column}=${String(pk[column])}`)
    .join('|');
}

/** Same-origin content path — never a storage destination's own URL (37 D24). */
export function documentContentPath(id: string): string {
  return `${BASE}/${encodeURIComponent(id)}/content`;
}

/** The sandboxed print view. Opened in a new tab, never embedded. */
export function documentPrintPath(id: string): string {
  return `${BASE}/${encodeURIComponent(id)}/print`;
}
