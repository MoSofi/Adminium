// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CrudApi — the typed data-access adapter the `page-crud` template receives
 * as a prop. The template never fetches; the dashboard interpreter
 * implements this against the generated CRUD API
 * (apps/server/src/routes/data) and hands it in:
 *
 * list GET /api/v1/data/:connectionId/:table get GET
 *   /api/v1/data/:connectionId/:table/:recordId(?include=inboundCounts) create POST
 *   /api/v1/data/:connectionId/:table update PATCH
 *   /api/v1/data/:connectionId/:table/:recordId remove DELETE
 *   /api/v1/data/:connectionId/:table/:recordId(?dryRun|confirm) references GET
 *   /api/v1/data/:connectionId/:table/:recordId/references bulk POST
 *   /api/v1/data/:connectionId/:table/bulk undo POST /api/v1/data/undo/:token lookup GET
 *   list on the FK's referenced table (q= on display column) listRelated GET list on a
 *   referencing table (where column = value) export POST /api/v1/exports (a queued
 *   export-run job)
 *
 * Every shape below mirrors apps/server/src/routes/data/schema.ts verbatim
 * so the dashboard implementation is a straight `fetch` + JSON pass-through.
 */

import type { TabularExportFormat } from '../../lib/export.js';

export type CrudRow = Record<string, unknown>;

/** Filter grammar (apps/server/src/crud/filters.ts). */
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
  /**
   * Cross-table lookup specs, `alias:fkColumn[.fkColumn…].targetColumn` —
   * each aliases one referenced-table column into every row (the host derives
   * these from the page's lookup column specs). Repeatable `lookup=` params.
   */
  lookup?: readonly string[] | undefined;
  /**
   * Reverse-link aggregate specs, `alias:table.fkColumn:count` — each counts
   * the rows of a table whose FK points at this one, aliased into every row
   * (the host derives these from the page's reverse column specs).
   * Repeatable `agg=` params.
   */
  agg?: readonly string[] | undefined;
  /**
   * Derived-column spec, URL-encoded JSON mirroring the page's stored
   * `config.derived` block: `{"measures":[…],"fields":[…]}`. ONE `compute=`
   * param, never repeated — measures fold a child table into each row and
   * fields compute arithmetic over them server-side.
   */
  compute?: string | undefined;
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
  /** Single-use undo token; null when not undoable. */
  undoToken: string | null;
  /**
   * How many rows one create wrote. Present only for a `repeat` create, where
   * `data` is the FIRST of them — a toast counting replies would otherwise say
   * "1 added" about five.
   */
  created?: number;
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
 * Export formats the server can actually build. `xlsx` is in the
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
  /**
   * The detail line under the name, already joined: "Internal medicine · Bldg 2".
   * The host joins it, because it is the host that read the columns.
   */
  detail?: string | undefined;
}

/**
 * Which columns of the target a reference shows: the NAME line, and up to two
 * DETAIL columns joined by " · ".
 *
 * They ride the lookup call rather than being read from the page, because they
 * decide the request itself — the picker asks for these columns and no others,
 * so a search does not pull whole rows (masked columns included) to render one
 * label.
 */
export interface CrudLookupFields {
  name?: string | undefined;
  detail?: readonly string[] | undefined;
}

export interface CrudApi {
  list(params: CrudListParams): Promise<CrudListResult>;
  /** `recordId`: single PK value, or JSON tuple/object for composite PKs. */
  get(
    recordId: string,
    options?: {
      include?: 'inboundCounts' | undefined;
      lookup?: readonly string[] | undefined;
      agg?: readonly string[] | undefined;
      /** Derived-column spec — see {@link CrudListParams.compute}. */
      compute?: string | undefined;
    },
  ): Promise<CrudGetResult>;
  /**
   * `links` are the target keys each relation should end up pointing at — rows
   * of a join table, written in the same transaction as this record. A
   * relation the object does not name is left alone.
   */
  create(
    values: CrudRow,
    links?: Record<string, string[]>,
    /**
     * Rows of ANOTHER table written in the same transaction — an invoice's
     * lines. A row with no `key` is being added; a key the object leaves out is
     * being removed. A relation the object does not name is left alone.
     */
    children?: Record<string, { key?: CrudRow | undefined; values: CrudRow }[]>,
    /**
     * One record per value of this column, all in one transaction under one
     * undo token — the invitations field. The rest of `values` is shared.
     */
    repeat?: { column: string; values: string[] },
  ): Promise<CrudMutationResult>;
  update(
    recordId: string,
    patch: CrudRow,
    links?: Record<string, string[]>,
    children?: Record<string, { key?: CrudRow | undefined; values: CrudRow }[]>,
  ): Promise<CrudMutationResult>;
  /**
   * The records one relation links this record to, with their names — what the
   * chips show before anybody searches. Optional: without it a link field
   * renders the keys it was given and nothing else.
   */
  links?(
    recordId: string,
    relationId: string,
  ): Promise<{ key: string; name: string; detail?: string | undefined }[]>;
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
  /**
   * Which instants a temporal column already holds in a window — the read
   * behind a calendar's struck-out days and slots. DISTINCT, so the reply is
   * bounded by the number of slots rather than by the number of rows, and
   * `capped` says when even that was too many. Optional: without it a calendar
   * strikes nothing out, which is the honest picture of "not checked".
   */
  availability?(query: {
    column: string;
    from: string;
    to: string;
    resource?: string | undefined;
    resourceValue?: string | undefined;
    exclude?: string | undefined;
  }): Promise<{ taken: string[]; capped: boolean }>;
  /** Bulk update/delete — one transaction, one undo token (optional). */
  bulk?(action: 'update' | 'delete', ids: readonly unknown[], values?: CrudRow): Promise<CrudBulkResult>;
  /**
   * FK combobox feed: search the referenced table's display column
   * (debounced 200ms server-side search). Optional — FK fields degrade
   * to a plain input without it.
   *
   * `display` is the referenced table's own display column, which generation
   * already stamps onto every FK spec as `fk.display` (`buildColumnDef` →
   * `crudDisplayColumns`). Passing it is what stops the client GUESSING a
   * label: before this, the picker scanned each row for `name`, `title`,
   * `label`, `display_name`, `full_name` or `email` and fell back to the first
   * non-empty string in the row — so a `companies` table keyed by `company`
   * showed raw ids, and a table with an unrelated text column first showed
   * that column's value.
   */
  lookup?(
    fk: { table: string; column: string; display?: string | undefined },
    query: string,
    /** The field's reference settings; absent ⇒ the display column alone. */
    fields?: CrudLookupFields | undefined,
  ): Promise<CrudLookupOption[]>;
  /**
   * Related records for detail tabs (inbound FKs): rows of `ref.table`
   * where `ref.column = value`. Optional — tabs show counts only without it.
   */
  listRelated?(ref: { table: string; column: string; value: unknown; limit?: number | undefined }): Promise<CrudRow[]>;
  /**
   * Queue a server-side export of the current selection/query — `POST
   * /exports`, which streams the WHOLE result set through the masking
   * pipeline into a stored artifact. Optional: without it the bulk toolbar's
   * Export serializes the selected rows in the browser instead, so the
   * button works either way (the difference is fidelity and reach, not
   * whether anything happens).
   */
  export?(request: CrudExportRequest): Promise<CrudExportTicket>;
}
