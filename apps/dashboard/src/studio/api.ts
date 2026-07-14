/**
 * Studio API client (M5-T01/T02/T03) — thin typed wrappers over the connect
 * flow endpoints. Shapes mirror the server Zod reply schemas
 * (`apps/server/src/routes/{connections,generate,schema,schema-import,jobs}/schema.ts`)
 * — the copied-mirror convention from app/bootstrap.ts applies: change both
 * together.
 */

import { api } from '../app/api.js';

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

export const studioApi = {
  /** Capability probe only — never persists (§2.4). */
  testDsn: (engine: ConnectionEngine, dsn: string) =>
    api.post<ConnectionTestResult>('/api/v1/connections/test', { engine, dsn }),

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
};
