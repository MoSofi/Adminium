// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Data-io API client — thin typed wrappers over `/api/v1/imports` +
 * `/api/v1/exports`. Shapes mirror the server Zod reply schemas
 * (`apps/server/src/routes/{imports,exports}/schema.ts`) — the copied-mirror
 * convention from studio/api.ts applies: change both together.
 */

import { queryOptions } from '@tanstack/react-query';

import { api, ApiError, csrfHeaders } from '../app/api.js';

// --- imports --------------------------------------------------------------------

export interface ImportMapping {
  columns: { from: string; to: string | null }[];
}

export interface ImportOptions {
  mode?: 'insert' | 'upsert';
  matchColumn?: string | null;
  skipInvalid?: boolean;
}

export interface ImportStats {
  total: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
}

export type ImportStatus = 'validating' | 'ready' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ImportDto {
  id: string;
  connectionId: string;
  tableName: string;
  requestedBy: string;
  fileId: string;
  mapping: ImportMapping;
  options: ImportOptions;
  status: ImportStatus;
  stats: ImportStats | null;
  errorReportFileId: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface UploadPreview {
  fileId: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  columns: string[];
  sampleRows: string[][];
  totalRows: number;
}

export interface ValidationIssueDto {
  row: number;
  column: string;
  code: string;
  message: string;
  value: string;
}

export interface ValidationReportDto {
  total: number;
  valid: number;
  invalid: number;
  issues: ValidationIssueDto[];
}

// --- exports --------------------------------------------------------------------

export type ExportFormat = 'csv' | 'json' | 'xlsx';
export type ExportStatus = 'processing' | 'ready' | 'failed' | 'cancelled' | 'expired';

/** One column of an export definition — mirrors meta's `exportColumnSchema`. */
export interface ExportColumnDef {
  name: string;
  label: string;
  lookup?: { path: string[]; select: string };
  reverse?: { table: string; fkColumn: string; agg: 'count' };
  derived?: { ref: string };
}

export interface ExportOptions {
  headerRow?: boolean;
  fileName?: string;
}

export interface ExportSource {
  kind: 'table' | 'view' | 'page';
  table?: string | null;
  viewId?: string | null;
  filters?: unknown[];
  /** The builder's definition; absent on legacy rows. */
  columns?: ExportColumnDef[];
  /** A `CrudDerivedConfig` — measures and fields the columns refer to. */
  derived?: unknown;
  options?: ExportOptions;
}

// --- the builder's reads ---------------------------------------------

export interface ExportSourcePage {
  id: string;
  title: string;
  columns: number;
  linked: number;
  totals: number;
}

export interface ExportSourceTable {
  id: string;
  schema: string;
  name: string;
  label: string | null;
  rowCountEstimate: number | null;
  columnCount: number;
  canExport: boolean;
  usedBy: number;
  pages: ExportSourcePage[];
}

export interface ExportSourcesDto {
  connection: { id: string; name: string; dialect: string };
  tables: ExportSourceTable[];
}

export interface ExportSavedViewDto {
  id: string;
  pageId: string;
  pageTitle: string;
  name: string;
  filterCount: number;
  filters: unknown[];
  hasSearch: boolean;
  rowCount: number | null;
}

export interface ExportPreviewColumn {
  key: string;
  header: string;
  kind: 'base' | 'lookup' | 'count' | 'measure' | 'field';
  numeric: boolean;
  masked: boolean;
}

export interface ExportPreviewDto {
  columns: ExportPreviewColumn[];
  rows: string[][];
  raw: string[];
  rowCount: number | null;
  rowCountKind: 'exact' | 'estimate' | 'unknown';
  estimatedBytes: number | null;
  sampleRows: number;
}

export interface ExportDto {
  id: string;
  connectionId: string | null;
  requestedBy: string;
  source: ExportSource;
  format: ExportFormat;
  status: ExportStatus;
  fileId: string | null;
  filename: string | null;
  sizeBytes: number | null;
  rowCount: number | null;
  error: string | null;
  jobId: string | null;
  createdAt: number;
  completedAt: number | null;
  expiresAt: number | null;
}

export interface JobDto {
  id: string;
  kind: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: { pct: number; step?: string | null; message?: string | null } | null;
  lastError: string | null;
}

// --- client ----------------------------------------------------------------------

/** Raw `text/csv` upload — the one non-JSON call in the SPA (route contract). */
async function uploadImportFile(file: File): Promise<UploadPreview> {
  const response = await fetch(
    `/api/v1/imports/upload?filename=${encodeURIComponent(file.name === '' ? 'upload.csv' : file.name)}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      // Hand-rolled fetch ⇒ hand-rolled CSRF header. Without it
      // every CSV import 403s at the upload step.
      headers: { accept: 'application/json', 'content-type': 'text/csv', ...csrfHeaders() },
      body: file,
    },
  );
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // handled below
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
        : `Upload failed with status ${response.status}.`,
      typeof envelope.error?.requestId === 'string'
        ? envelope.error.requestId
        : (response.headers.get('x-request-id') ?? null),
      envelope.error?.details,
    );
  }
  return (body as { data: UploadPreview }).data;
}

export const dataIoApi = {
  uploadImportFile,

  createImport: (input: {
    fileId: string;
    connectionId: string;
    table: string;
    mapping: ImportMapping;
    options: ImportOptions;
  }) =>
    api.post<{ data: { import: ImportDto; report: ValidationReportDto } }>('/api/v1/imports', input),

  runImport: (id: string) =>
    api.post<{ data: { import: ImportDto; jobId: string } }>(
      `/api/v1/imports/${encodeURIComponent(id)}/run`,
    ),

  getImport: async (id: string) =>
    (await api.get<{ data: ImportDto }>(`/api/v1/imports/${encodeURIComponent(id)}`)).data,

  listImports: async () => (await api.get<{ data: ImportDto[] }>('/api/v1/imports')).data,

  errorReportHref: (id: string) => `/api/v1/imports/${encodeURIComponent(id)}/error-report`,

  createExport: (input: { connectionId: string; source: ExportSource; format: ExportFormat }) =>
    api.post<{ data: ExportDto }>('/api/v1/exports', input),

  listExports: async () => (await api.get<{ data: ExportDto[] }>('/api/v1/exports')).data,

  getExport: async (id: string) =>
    (await api.get<{ data: ExportDto }>(`/api/v1/exports/${encodeURIComponent(id)}`)).data,

  downloadHref: (id: string) => `/api/v1/exports/${encodeURIComponent(id)}/download`,

  exportSources: async (connectionId: string) =>
    (
      await api.get<{ data: ExportSourcesDto }>(
        `/api/v1/exports/sources?connectionId=${encodeURIComponent(connectionId)}`,
      )
    ).data,

  exportViews: async (connectionId: string, table: string) =>
    (
      await api.get<{ data: { views: ExportSavedViewDto[] } }>(
        `/api/v1/exports/views?connectionId=${encodeURIComponent(connectionId)}&table=${encodeURIComponent(table)}`,
      )
    ).data.views,

  previewExport: async (input: {
    connectionId: string;
    source: ExportSource;
    format: ExportFormat;
    sampleRows?: number;
  }) => (await api.post<{ data: ExportPreviewDto }>('/api/v1/exports/preview', input)).data,

  getJob: async (jobId: string): Promise<JobDto> =>
    (await api.get<{ data: JobDto }>(`/api/v1/jobs/${encodeURIComponent(jobId)}`)).data,
};

// --- query bindings ----------------------------------------------------------------

export function exportsListQuery() {
  return queryOptions({
    queryKey: ['data-io', 'exports'] as const,
    queryFn: () => dataIoApi.listExports(),
    // Poll while anything is processing; realtime jobs:<id> events refine this.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((row) => row.status === 'processing') ? 2_000 : false,
  });
}

export function exportQuery(id: string | null) {
  return queryOptions({
    queryKey: ['data-io', 'export', id] as const,
    queryFn: () => dataIoApi.getExport(id as string),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === 'processing' ? 1_000 : false),
  });
}

export function exportSourcesQuery(connectionId: string | null) {
  return queryOptions({
    queryKey: ['data-io', 'export-sources', connectionId] as const,
    queryFn: () => dataIoApi.exportSources(connectionId as string),
    enabled: connectionId !== null,
  });
}

export function exportViewsQuery(connectionId: string | null, table: string | null) {
  return queryOptions({
    queryKey: ['data-io', 'export-views', connectionId, table] as const,
    queryFn: () => dataIoApi.exportViews(connectionId as string, table as string),
    enabled: connectionId !== null && table !== null,
  });
}

export function importsListQuery() {
  return queryOptions({
    queryKey: ['data-io', 'imports'] as const,
    queryFn: () => dataIoApi.listImports(),
  });
}

export function importQuery(id: string, enabled = true) {
  return queryOptions({
    queryKey: ['data-io', 'import', id] as const,
    queryFn: () => dataIoApi.getImport(id),
    enabled,
    refetchInterval: (query) =>
      query.state.data !== undefined && (query.state.data.status === 'running' || query.state.data.status === 'ready')
        ? 1_000
        : false,
  });
}

export function jobQuery(jobId: string | null) {
  return queryOptions({
    queryKey: ['data-io', 'job', jobId] as const,
    queryFn: () => dataIoApi.getJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === undefined || status === 'pending' || status === 'running' ? 1_000 : false;
    },
  });
}
