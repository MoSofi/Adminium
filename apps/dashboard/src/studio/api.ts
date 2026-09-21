// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio API client — thin typed wrappers over the connect flow endpoints. Shapes
 * mirror the server Zod reply schemas
 * (`apps/server/src/routes/{connections,generate,schema,schema-import,jobs}/schema.ts`)
 * — the copied-mirror convention from app/bootstrap.ts applies: change both together.
 */

import { api, ApiError, csrfHeaders } from '../app/api.js';
import type { SchemaAuthoring } from './pages/schemaAuthoringReason.js';

export type ConnectionEngine = 'postgres' | 'mysql' | 'sqlite';

export type GenerateIntent = 'full-admin' | 'read-only-analytics' | 'crud' | 'support-console';

export interface ConnectionSettings {
  includedTables?: string[];
  intent?: GenerateIntent;
}

export interface DsnPrivileges {
  canReadSchema: boolean;
  canRead: boolean;
  canWrite: boolean;
  canDDL: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  serverVersion: string | null;
  readOnly: boolean;
  privileges: DsnPrivileges | null;
  error: { code: string; message: string; hint: string | null } | null;
}

export interface ConnectionDto {
  id: string;
  name: string;
  engine: string;
  sourceKind: string;
  dsnMasked: string | null;
  readOnly: boolean;
  status: string;
  lastTestedAt: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  /** Remediation copy for `lastError`, from the adapter. */
  lastErrorHint: string | null;
  snapshot: { id: string; createdAt: number; checksum: string } | null;
  /**
   * Tenant configuration — properties of the BUSINESS the database belongs
   * to, not of any one front end. Carried on the connection because a hosted
   * surface has no scope and no publishable key, so this is the only place it
   * can read them from.
   *
   * Both nullable. A null zone no longer stops a surface rendering — apps fall
   * back to {@link serverTimezone} — but it is still the value every date there
   * is drawn through, so a wrong one is off by hours and looks like data.
   */
  timezone: string | null;
  /**
   * Who chose {@link timezone} (meta wave 0018). `'host'` means the server
   * seeded its own zone and nobody has confirmed it; `null` is no claim, which
   * must render as nothing rather than as a guess.
   */
  timezoneSource: 'host' | 'operator' | null;
  /**
   * This server's own zone, reported on every connection and never stored.
   *
   * It is what a hosted surface renders dates in when {@link timezone} is
   * null, so the card can name the zone in use instead of only saying the
   * field is empty. Never write it back: saving it would record a guess as the
   * operator's decision.
   */
  serverTimezone: string;
  currency: string | null;
  /**
   * Paused by an operator (meta wave 0019) — Adminium opens no connection to
   * this source until it is resumed.
   *
   * Reported alongside `status` rather than folded into it: `status` is the
   * last probe's reading, so a connection that was failing when it was paused
   * still says `error`, and the card can be honest about both at once.
   */
  disabled: boolean;
  /** When it was paused; null while it is serving. */
  disabledAt: number | null;
  /** Included tables (allowlist, else last snapshot); null before introspection. */
  tableCount: number | null;
  /** Generated pages owned by this connection. */
  pageCount: number;
  createdAt: number;
  updatedAt: number;
}

export type IntrospectResult =
  | { kind: 'done'; snapshotId: string; noop: boolean; proposedMasks: number; checksum: string }
  | { kind: 'job'; jobId: string };

export interface JobView {
  id: string;
  kind: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: { pct: number; step?: string | null; message?: string | null } | null;
  lastError: string | null;
}

/**
 * Subset of the engine `DatabaseModel` the wizard and the page-column manager
 * read (schema GET reply). The manager needs enough of each column to compose
 * a `gridColumnSpecSchema` entry exactly as regeneration would
 * (`buildColumnDef` in @adminium/widgets/generate) — hence the
 * form/classifier facts beyond the wizard's needs.
 */
export interface SchemaColumn {
  name: string;
  ordinal?: number;
  logicalType: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  isUnique?: boolean;
  isGenerated?: boolean;
  /** `ColumnDefault` — the manager only reads `kind`. */
  default?: { kind: string } | null;
  maxLength?: number | null;
  /** `EnumDef.id` when logicalType='enum'. */
  enumRef?: string | null;
  /** Outbound FK mirror — drives the lookup-column browser. */
  references?: { tableId: string; column: string } | null;
  semantics?: {
    primary?: string;
    format?: string | null;
    flags?: { secret?: boolean; pii?: string | null; maskedByDefault?: boolean };
  } | null;
}

export interface SchemaTable {
  id: string;
  schema: string;
  name: string;
  label?: string;
  columns: SchemaColumn[];
  primaryKey?: string[];
  rowCountEstimate: number | null;
  system?: boolean;
  semantics?: { role?: string } | null;
}

export interface SchemaReply {
  connectionId: string;
  snapshotId: string;
  checksum: string;
  createdAt: number;
  source: string;
  model: { tables: SchemaTable[]; enums?: { id: string; values: string[] }[] };
  appliedOverrides: number;
  /**
   * Whether this connection's schema can be authored at all, and why not.
   *
   * OPTIONAL on purpose: a server one release behind does not send it, and
   * every reader treats absent as authorable — the tolerance `RemapEditor`
   * established and `schemaAuthoringReason.ts` documents. Hiding a working flow
   * because a field is missing breaks an install that was fine.
   */
  schemaAuthoring?: SchemaAuthoring;
}

export interface GenerateResult {
  pages: number;
  navGroups: string[];
  snapshotId: string;
  introspected: boolean;
  intent: GenerateIntent;
  result: { created: number; updated: number; unchanged: number; pruned: number; preserved: string[] };
  warnings: string[];
  durationMs: number;
}

export interface SchemaImportPreview {
  model: unknown;
  format: string;
  warnings: string[];
  summary: { tables: number; columns: number; relations: number; enums: number };
}

/**
 * DELETE with a JSON body — `app/api.ts` has no payload-carrying delete and
 * lives outside this feature's paths this wave (the putJson precedent above
 * in remap/api.ts applies); fold into `api.delete` once the owner extends it.
 */
async function deleteJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'DELETE',
    credentials: 'same-origin',
    // Hand-rolled fetch ⇒ hand-rolled CSRF header. Without it
    // the delete-connection confirm 403s.
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

export const studioApi = {
  /** Capability probe only — never persists. */
  testDsn: (engine: ConnectionEngine, dsn: string) =>
    api.post<ConnectionTestResult>('/api/v1/connections/test', { engine, dsn }),

  /** Hub list — health, snapshot age, table + generated-page counts. */
  listConnections: async () =>
    (await api.get<{ connections: ConnectionDto[] }>('/api/v1/connections')).connections,

  /** Re-test an existing connection's data role; persists the health result. */
  testConnection: (id: string) =>
    api.post<ConnectionTestResult>(`/api/v1/connections/${encodeURIComponent(id)}/test`),

  /** Type-to-confirm delete — the server re-checks `confirmName`. */
  deleteConnection: (id: string, confirmName: string) =>
    deleteJson<{ ok: true }>(`/api/v1/connections/${encodeURIComponent(id)}`, { confirmName }),

  createConnection: (input: {
    name: string;
    engine: ConnectionEngine;
    dsn: string;
    settings?: ConnectionSettings;
  }) => api.post<ConnectionDto>('/api/v1/connections', input),

  /**
   * `timezone`/`currency` are explicitly `| null`, not merely optional: the
   * server distinguishes "leave it alone" (omitted) from "clear it" (null),
   * and an operator has to be able to undo a zone they set by mistake.
   */
  patchConnection: (
    id: string,
    patch: {
      name?: string;
      settings?: ConnectionSettings;
      timezone?: string | null;
      currency?: string | null;
      /** Pause (`true`) / resume (`false`). Omitted leaves the pause alone. */
      disabled?: boolean;
    },
  ) => api.patch<ConnectionDto>(`/api/v1/connections/${encodeURIComponent(id)}`, patch),

  /** 200 sync result or 202 `{ jobId }` when the jobs worker is wired. */
  introspect: async (id: string): Promise<IntrospectResult> => {
    const reply = await api.post<
      { snapshotId: string; noop: boolean; proposedMasks: number; checksum: string } | { jobId: string }
    >(`/api/v1/connections/${encodeURIComponent(id)}/introspect`);
    return 'jobId' in reply ? { kind: 'job', jobId: reply.jobId } : { kind: 'done', ...reply };
  },

  getJob: async (jobId: string): Promise<JobView> =>
    (await api.get<{ data: JobView }>(`/api/v1/jobs/${encodeURIComponent(jobId)}`)).data,

  getSchema: (id: string) =>
    api.get<SchemaReply>(`/api/v1/connections/${encodeURIComponent(id)}/schema`),

  generate: (id: string, intent: GenerateIntent) =>
    api.post<GenerateResult>(`/api/v1/connections/${encodeURIComponent(id)}/generate`, { intent }),

  parseSchemaFile: (input: { content: string; format?: string; fileName?: string }) =>
    api.post<SchemaImportPreview>('/api/v1/schema-import/parse', input),

  /**
   * Where Adminium's own tables live. 404s on a topology that cannot restart
   * itself (the route is not registered) — callers treat that as "no move
   * available" rather than as an error.
   */
  getMetaPlacement: async (): Promise<MetaStoreLocation> =>
    (await api.get<{ data: MetaStoreLocation }>('/api/v1/meta/placement')).data,

  /**
   * Move the meta store. The server replies BEFORE restarting, so a resolved
   * promise means "the copy committed", not "the server is back" — follow it
   * with {@link waitForRestart}.
   */
  /**
   * `park` renames the target's existing `adminium_` tables out of the way
   * instead of refusing. Only the first-run wizard sets it, and only after
   * telling the operator which tables are there.
   */
  relocateMeta: async (dsn: string, opts: { park?: boolean } = {}): Promise<MetaRelocated> =>
    (
      await api.post<{ data: MetaRelocated }>('/api/v1/meta/relocate', {
        dsn,
        ...(opts.park === true ? { park: true } : {}),
      })
    ).data,
};

/**
 * Where the meta store IS. Named apart from `wizardState.ts`'s `MetaPlacement`,
 * which is the user's CHOICE between same-db and separate-db — the two live
 * side by side in this step and conflating them was a name collision waiting to
 * become a logic one.
 */
export interface MetaStoreLocation {
  source: 'env' | 'bootstrap' | 'embedded';
  engine: ConnectionEngine;
  embedded: boolean;
  canRelocate: boolean;
  reason: string | null;
}

export interface MetaRelocated {
  engine: ConnectionEngine;
  rowsCopied: number;
  restarting: boolean;
  healthPath: string;
}

/**
 * Poll until the server answers again after a relocation restart.
 *
 * Every failure mode here is EXPECTED and must not abort the wait: the socket
 * is dropped mid-flight, then the port refuses connections while the process
 * rebuilds its service graph, then it answers. So fetch rejections are swallowed
 * and only the deadline ends the loop. `cache: 'no-store'` because a cached 200
 * from before the restart would end the wait early, against a server that is
 * still down.
 */
export async function waitForRestart(
  healthPath: string,
  opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted === true) return false;
    try {
      const response = await fetch(healthPath, { cache: 'no-store' });
      if (response.ok) return true;
    } catch {
      // Connection refused / reset — the restart in progress. Keep waiting.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/*
 * `connectionHealthQuery` MOVED to `shell/connectionHealth.ts`
 * (38d, entry-budget attribution).
 *
 * Its only consumer is `shell/RuntimeChipHost.tsx`, which renders on the FIRST
 * PAINT — so importing it from here put this whole module in the entry chunk
 * for every user on every route, to serve a poll that is `enabled` on desktop
 * alone. Everything else in this file belongs to Studio surfaces that are
 * lazy by design.
 */
