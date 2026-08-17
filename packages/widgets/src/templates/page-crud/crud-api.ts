/**
 * CrudApi — the typed data-access adapter the `page-crud` template receives
 * as a prop. The template never fetches; the dashboard interpreter
 * implements this against the generated CRUD API
 * (apps/server/src/routes/data, 08-server-api.md §2.7) and hands it in:
 *
 *   list        GET    /api/v1/data/:connectionId/:table
 *   get         GET    /api/v1/data/:connectionId/:table/:recordId(?include=inboundCounts)
 *   create      POST   /api/v1/data/:connectionId/:table
 *   update      PATCH  /api/v1/data/:connectionId/:table/:recordId
 *   remove      DELETE /api/v1/data/:connectionId/:table/:recordId(?dryRun|confirm)
 *   references  GET    /api/v1/data/:connectionId/:table/:recordId/references
 *   bulk        POST   /api/v1/data/:connectionId/:table/bulk
 *   undo        POST   /api/v1/data/undo/:token
 *   lookup      GET    list on the FK's referenced table (q= on display column)
 *   listRelated GET    list on a referencing table (where column = value)
 *   export      POST   /api/v1/exports  (09 §11.2, a queued export-run job)
 *
 * Every shape below mirrors apps/server/src/routes/data/schema.ts verbatim
 * so the dashboard implementation is a straight `fetch` + JSON pass-through.
 */

import type { TabularExportFormat } from '../../lib/export.js';

export type CrudRow = Record<string, unknown>;

/** Filter grammar (08 §2.7.1, apps/server/src/crud/filters.ts). */
export const CRUD_FILTER_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'like',
  'ilike',
  'is_null',
  'not_null',
  'between',
] as const;
export type CrudFilterOp = (typeof CRUD_FILTER_OPS)[number];

export interface CrudFilterCondition {
  column: string;
  op: CrudFilterOp;
  /** Required except for is_null / not_null. */
  value?: unknown;
}

export type CrudFilter =
  | CrudFilterCondition
  | { and: CrudFilter[] }
  | { or: CrudFilter[] };

export interface CrudSort {
  column: string;
  dir: 'asc' | 'desc';
}

export interface CrudListParams {
  /** Column projection (PKs always ride along server-side). */
  select?: readonly string[] | undefined;
  /** Filter tree — serialized to the `where` query param as JSON. */
  where?: CrudFilter | undefined;
  /** Tokenized substring search over text columns (`q`). */
  q?: string | undefined;
  /** ≤ 3 sort keys — serialized `col.desc,col2.asc`. */
  order?: readonly CrudSort[] | undefined;
  limit?: number | undefined;
  /** Offset mode — mutually exclusive with `cursor`. */
  offset?: number | undefined;
  /** Keyset mode; empty string requests the first keyset page. */
  cursor?: string | undefined;
  count?: 'exact' | 'estimated' | 'none' | undefined;
}

export interface CrudListResult {
  data: CrudRow[];
  /** Present in offset mode. */
  page?: { limit: number; offset: number; total: number | null } | undefined;
  /** Present in keyset mode; `next: null` on the last page. */
  cursor?: { next: string | null } | undefined;
}

/** One inbound-reference count (delete preflight / detail tabs). */
export interface CrudReferenceCount {
  relationId: string;
  /** Referencing qualified table ("public.orders"). */
  table: string;
  /** Referencing FK column. */
  column: string;
  count: number;
}

export interface CrudGetResult {
  data: CrudRow;
  /** Present when requested with `include: 'inboundCounts'`. */
  inboundCounts?: CrudReferenceCount[] | undefined;
}

export interface CrudMutationResult {
  data: CrudRow | null;
  /** Single-use undo token (§2.7.3); null when not undoable. */
  undoToken: string | null;
}

/** `remove({ dryRun: true })` — the cascade-modal payload; no write happens. */
export interface CrudDeletePreview {
  references: CrudReferenceCount[];
  requiresConfirm: boolean;
}

export function isDeletePreview(result: CrudMutationResult | CrudDeletePreview): result is CrudDeletePreview {
  return typeof result === 'object' && result !== null && 'references' in result && !('data' in result);
}

export interface CrudBulkResult {
  results: { id: unknown; ok: boolean; error?: string | undefined }[];
  undoToken: string | null;
}

/**
 * Export formats the server can actually build. `xlsx` is in the §3.25
 * vocabulary but `POST /exports` rejects it with a 422 (no spreadsheet
 * dependency exists in this repo), so it is not in the contract; `json` is
 * JSON-lines, matching the `export-run` artifact.
 */
export type CrudExportFormat = TabularExportFormat;

export interface CrudExportRequest {
  format: CrudExportFormat;
  /** Selected row ids, when the request came from the bulk toolbar. */
  ids?: readonly string[] | undefined;
  /** The grid's live query, so a whole-result export matches what is on screen. */
  params?: CrudListParams | undefined;
}

/** `POST /exports` reply (202), narrowed to what the template shows. */
export interface CrudExportTicket {
  /** `adminium_exports.id` — the row the Data Exports page polls. */
  id: string;
  status: 'processing' | 'ready' | 'failed' | 'cancelled' | 'expired';
}

/** FK combobox option (async server-side search on the display column). */
export interface CrudLookupOption {
  /** The referenced key value, stringified. */
  value: string;
  /** Display-column value ("Ada Lovelace"). */
  label: string;
  description?: string | undefined;
}

export interface CrudApi {
  list(params: CrudListParams): Promise<CrudListResult>;
  /** `recordId`: single PK value, or JSON tuple/object for composite PKs. */
  get(recordId: string, options?: { include?: 'inboundCounts' | undefined }): Promise<CrudGetResult>;
  create(values: CrudRow): Promise<CrudMutationResult>;
  update(recordId: string, patch: CrudRow): Promise<CrudMutationResult>;
  /**
   * Delete. `dryRun` returns the referential-consequence preview;
   * `confirm` is required once the preview reports inbound references.
   */
  remove(
    recordId: string,
    options?: { dryRun?: boolean | undefined; confirm?: boolean | undefined },
  ): Promise<CrudMutationResult | CrudDeletePreview>;
  /** Standalone references preflight (same payload as `remove({dryRun})`). */
  references(recordId: string): Promise<CrudReferenceCount[]>;
  /** Consume a single-use undo token from any mutation above. */
  undo(token: string): Promise<{ restoredIds: unknown[] }>;
  /** Bulk update/delete — one transaction, one undo token (optional). */
  bulk?(action: 'update' | 'delete', ids: readonly unknown[], values?: CrudRow): Promise<CrudBulkResult>;
  /**
   * FK combobox feed: search the referenced table's display column
   * (debounced 200ms server-side search, 09 §7.1). Optional — FK fields
   * degrade to a plain input without it.
   */
  lookup?(
    fk: { table: string; column: string },
    query: string,
  ): Promise<CrudLookupOption[]>;
  /**
   * Related records for detail tabs (inbound FKs): rows of `ref.table`
   * where `ref.column = value`. Optional — tabs show counts only without it.
   */
  listRelated?(ref: { table: string; column: string; value: unknown; limit?: number | undefined }): Promise<CrudRow[]>;
  /**
   * Queue a server-side export of the current selection/query — `POST
   * /exports` (09 §11.2), which streams the WHOLE result set through the
   * masking pipeline into a stored artifact. Optional: without it the bulk
   * toolbar's Export serializes the selected rows in the browser instead, so
   * the button works either way (the difference is fidelity and reach, not
   * whether anything happens).
   */
  export?(request: CrudExportRequest): Promise<CrudExportTicket>;
}
