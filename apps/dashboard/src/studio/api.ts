/**
 * Studio API client (M5-T01/T02/T03) — thin typed wrappers over the connect
 * flow endpoints. Shapes mirror the server Zod reply schemas
 * (`apps/server/src/routes/{connections,generate,schema,schema-import,jobs}/schema.ts`)
 * — the copied-mirror convention from app/bootstrap.ts applies: change both
 * together.
 */

import { queryOptions } from '@tanstack/react-query';

import { api, ApiError } from '../app/api.js';

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
  snapshot: { id: string; createdAt: number; checksum: string } | null;
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

/** Subset of the engine `DatabaseModel` the wizard reads (schema GET reply). */
export interface SchemaColumn {
  name: string;
  logicalType: string;
  semantics?: {
    flags?: { pii?: string | null; maskedByDefault?: boolean };
  } | null;
}

export interface SchemaTable {
  id: string;
  schema: string;
  name: string;
  columns: SchemaColumn[];
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
  model: { tables: SchemaTable[] };
  appliedOverrides: number;
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
    headers: { accept: 'application/json', 'content-type': 'application/json' },
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
  /** Capability probe only — never persists (§2.4). */
  testDsn: (engine: ConnectionEngine, dsn: string) =>
    api.post<ConnectionTestResult>('/api/v1/connections/test', { engine, dsn }),

  /** Hub list — health, snapshot age, table + generated-page counts (§2.4). */
  listConnections: async () =>
    (await api.get<{ connections: ConnectionDto[] }>('/api/v1/connections')).connections,

  /** Re-test an existing connection's data role; persists the health result. */
  testConnection: (id: string) =>
    api.post<ConnectionTestResult>(`/api/v1/connections/${encodeURIComponent(id)}/test`),

  /** Type-to-confirm delete — the server re-checks `confirmName` (§2.4). */
  deleteConnection: (id: string, confirmName: string) =>
    deleteJson<{ ok: true }>(`/api/v1/connections/${encodeURIComponent(id)}`, { confirmName }),

  createConnection: (input: {
    name: string;
    engine: ConnectionEngine;
    dsn: string;
    settings?: ConnectionSettings;
  }) => api.post<ConnectionDto>('/api/v1/connections', input),

  patchConnection: (id: string, patch: { name?: string; settings?: ConnectionSettings }) =>
    api.patch<ConnectionDto>(`/api/v1/connections/${encodeURIComponent(id)}`, patch),

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
  relocateMeta: async (dsn: string): Promise<MetaRelocated> =>
    (await api.post<{ data: MetaRelocated }>('/api/v1/meta/relocate', { dsn })).data,
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

/**
 * 11-electron.md §8.1's "lightweight connection-health poll" — the second of the
 * two feeds behind the desktop runtime chip (`shell/RuntimeChipHost.tsx`).
 *
 * It is the same `GET /api/v1/connections` the Studio hub reads, under a
 * SEPARATE query key, and the separation is the point. `['studio','connections']`
 * is the hub's: it is fetched when someone opens Studio and invalidated when
 * they act, which is right for a page and wrong for a badge that has to notice a
 * database going away while the user is somewhere else entirely. Sharing the key
 * would mean either polling the hub's data for every user who never opens it, or
 * a chip that only tells the truth on one route.
 *
 * "Lightweight" is the persisted-health part: the reply's `status` is the last
 * test's recorded outcome (`connections/schema.ts`), so this polls the meta
 * store, never the source databases. The chip cannot cause a connection storm —
 * and, honestly, cannot notice a database dying faster than something else
 * re-tests it.
 */
const CONNECTION_HEALTH_POLL_MS = 30_000;

export function connectionHealthQuery() {
  return queryOptions({
    queryKey: ['system', 'connection-health'] as const,
    queryFn: () => studioApi.listConnections(),
    /**
     * STOPS DEAD ON ERROR, and that is not a nicety. `GET /api/v1/connections`
     * is guarded by the Admin-only `system:connections:manage`, while the chip
     * that reads this renders in the topbar for EVERY signed-in user — so for an
     * Editor, a Viewer, or any of the §8.3 LAN users, this query's steady state
     * is 403. A plain interval would re-ask, and be refused, every 30 s for the
     * length of their session: a permanent background loop generating audit
     * noise and load to compute a badge they will never be shown.
     *
     * A 403 is not a flake. Nothing about waiting 30 s changes the answer, so
     * the poll stops until something invalidates the key.
     */
    refetchInterval: (query) => (query.state.error === null ? CONNECTION_HEALTH_POLL_MS : false),
    // A poll behind a badge must never escalate into a retry storm or a toast;
    // the previous answer is a better chip than no chip.
    retry: false,
  });
}
