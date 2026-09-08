// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The per-table file configuration a stored page carries — which columns hold
 * files, and whether the table takes sidecar attachments
 * (37-files-and-storage.md §3.5, §3.7, D6, 37-T13/T22).
 *
 * A DEVIATION FROM THE PLAN, AND WHY. §3.7 says the reconcile hook reads the
 * `file` block "from the page config the request already resolved (the route
 * has `ctx.page`)". It does not: `DataContext` in `routes/data/index.ts`
 * carries a connection, a snapshot view, a resolved table, a db handle, a
 * dialect and a mask flag — and no page. The data routes are addressed by
 * TABLE, not by page, which is what makes them usable from an API key and from
 * the record route alike.
 *
 * So the lookup is by `(connectionId, table)` instead, over the pages bound to
 * that table. That is strictly more correct than the plan's version would have
 * been: a table can be the source of more than one page, and a file column
 * configured on either of them is a file column whichever page the write came
 * through — including a write that came through no page at all, which is
 * exactly what an API-key caller does.
 *
 * MERGE ORDER when two pages configure the same column: the first page, by
 * creation order, wins. Deliberately deterministic rather than "most recently
 * edited": the reconcile hook's job is to decide whether a value is a file
 * reference, and every candidate block agrees on that; only `ref`,
 * `destinationId` and the caps could differ, and those matter at UPLOAD time,
 * where the caller names its column and its page.
 *
 * THE CACHE is per-instance and invalidated by time, not by page writes. The
 * blocks change when somebody edits a page in Studio, which is rare, and a
 * 30-second staleness window costs at most one write cycle of a column that
 * was just turned into a file column. Wiring page saves to an invalidation
 * callback would couple the pages routes to this module for a benefit nobody
 * would notice.
 */

import { z } from 'zod';
import { pagesRepo, type MetaDb } from '@adminium/meta';

/**
 * The server's OWN narrowing of the `file` block.
 *
 * `@adminium/widgets` owns the authoring shape (`columnFileSchema` on
 * `GridColumnSpec`) and the server may not import it — the 01 §2.3 import
 * matrix, enforced by `check-deps`. A stored page config is opaque JSON to this
 * process either way, so it narrows what it needs, exactly as
 * `pageSourceTable()` in the exports route narrows `config.source.table`.
 *
 * Deliberately NON-strict where the widgets schema is strict: a page written by
 * a NEWER dashboard may carry a field this server has never heard of, and
 * refusing the whole block for that would silently turn a configured file
 * column back into a plain text column mid-upgrade.
 */
const columnFileSchema = z.object({
  ref: z.enum(['url', 'id', 'key']).default('url'),
  destinationId: z.string().min(1).optional(),
  accept: z.array(z.string().min(1).max(20)).max(20).optional(),
  maxBytes: z.number().int().min(1024).optional(),
  inline: z.boolean().optional(),
  /**
   * The column stores a LIST of references rather than one (38 D1/D5) — the
   * shape the Attachments card creates. The reconciler and the write-time
   * validator both read this to decide whether a value is one reference or a
   * JSON array of them.
   */
  multiple: z.boolean().optional(),
  /** Refuse a write that would put more than this many files on one record. */
  maxCount: z.number().int().min(1).max(500).optional(),
});
export type ColumnFile = z.infer<typeof columnFileSchema>;

/**
 * The page-level `config.attachments` block — the SIDECAR mode's configuration
 * (`crudAttachmentsConfigSchema` in the widgets page-config leaf).
 *
 * WHY THE SERVER READS IT AT ALL. The dashboard could enforce `accept`,
 * `maxBytes` and `maxCount` on its own, and for a moment it did — which meant
 * three controls in the Studio that changed nothing an attacker had to
 * respect. A cap the client alone applies is a suggestion; the upload route is
 * the only place it becomes true. (Caught by the 37d review: "two of the
 * card's four fields are write-only controls with no consumer anywhere".)
 *
 * Non-strict for the same reason the column block is: a page written by a
 * newer dashboard must not silently stop taking attachments mid-upgrade.
 */
const attachmentsSchema = z.object({
  enabled: z.boolean(),
  destinationId: z.string().min(1).optional(),
  accept: z.array(z.string().min(1).max(20)).max(20).optional(),
  maxBytes: z.number().int().min(1024).optional(),
  maxCount: z.number().int().min(1).max(500).optional(),
  /**
   * The table's own column that holds this page's attachments (38 D14).
   *
   * Present ⇒ COLUMN mode: the files live in the customer's own table, the
   * caps that matter are the column block's, and this page has no sidecar —
   * `attachmentsFor` returns null so the sidecar's caps are never applied to a
   * page that does not use them.
   *
   * Absent ⇒ the sidecar, unchanged: files linked on Adminium's side, which is
   * the fallback for a connection whose schema Adminium cannot author (D2).
   */
  column: z.string().min(1).max(128).optional(),
});
export type PageAttachments = z.infer<typeof attachmentsSchema>;

/** How long a resolved block map is reused. See the header on why this is time-based. */
const CACHE_TTL_MS = 30_000;

export interface ColumnFileBlocks {
  /** Column name → its block. Empty when the table has no file columns. */
  byColumn: ReadonlyMap<string, ColumnFile>;
  /**
   * The table's SIDECAR configuration, or null when no page enables one.
   * First enabled page wins, by creation order — the same determinism the
   * column merge uses, and for the same reason.
   *
   * A page in column mode (`attachments.column`, 38 D14) contributes nothing
   * here: its files are a column value, and applying a sidecar's caps to it
   * would enforce a limit against the wrong mode.
   */
  attachments: PageAttachments | null;
}

/** The stored page shape this reads, narrowed the way every other consumer narrows it. */
interface StoredColumn {
  name?: unknown;
  file?: unknown;
}

/**
 * `adminium_pages.config` HOLDS THE WHOLE ENVELOPE, not the body — and the two
 * halves this module needs live at different depths because of it:
 *
 *   config.source.table     the binding      (envelope level)
 *   config.config.columns   the column specs (body level)
 *   config.config.attachments                (body level)
 *
 * That asymmetry is the bug this file shipped with: `source` was read correctly
 * and `columns` was read one level too high, so `byColumn` was empty for every
 * REAL page and the reconcile hook silently did nothing — no error, no warning,
 * just an upload that never attached. Unit tests missed it because they built
 * page configs by hand in the flat shape the reader assumed rather than in the
 * shape `pagesRepo` actually stores. `routes/pages/index.ts` reads the body as
 * `stored['config']` for the same reason; the exports route's `pageSourceTable`
 * reads `config.source.table` for the other half.
 */
function sourceTableOf(config: unknown): string | null {
  const source = (config as { source?: { table?: unknown } } | null)?.source;
  return typeof source?.table === 'string' && source.table.length > 0 ? source.table : null;
}

/** The stored envelope's BODY — where columns and `attachments` actually live. */
function bodyOf(config: unknown): Record<string, unknown> {
  const body = (config as { config?: unknown } | null)?.config;
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function columnsOf(config: unknown): StoredColumn[] {
  const columns = bodyOf(config)['columns'];
  return Array.isArray(columns) ? (columns as StoredColumn[]) : [];
}

export interface ColumnBlockReader {
  /** Every file column on a table, by column name. */
  forTable(connectionId: string, table: string): Promise<ColumnFileBlocks>;
  /** One column's block, or null — the column upload route's question. */
  forColumn(input: { connectionId: string; table: string; column: string }): Promise<ColumnFile | null>;
  /** The table's sidecar configuration, or null — the SIDECAR upload's question. */
  attachmentsFor(connectionId: string, table: string): Promise<PageAttachments | null>;
  /** Drop the cache (tests, and a page save that wants to be seen immediately). */
  clear(): void;
}

export function createColumnBlockReader(meta: MetaDb, opts: { now?: () => number } = {}): ColumnBlockReader {
  const pages = pagesRepo(meta);
  const now = opts.now ?? (() => Date.now());
  const cache = new Map<string, { at: number; blocks: ColumnFileBlocks }>();

  async function forTable(connectionId: string, table: string): Promise<ColumnFileBlocks> {
    const key = `${connectionId}\u0000${table}`;
    const hit = cache.get(key);
    if (hit !== undefined && now() - hit.at < CACHE_TTL_MS) return hit.blocks;

    const byColumn = new Map<string, ColumnFile>();
    let attachments: PageAttachments | null = null;
    for (const page of await pages.listForConnection(connectionId)) {
      if (sourceTableOf(page.config) !== table) continue;
      for (const column of columnsOf(page.config)) {
        if (typeof column.name !== 'string' || column.file === undefined || column.file === null) continue;
        if (byColumn.has(column.name)) continue;
        // Parsed, not cast: a stored page is data this process did not write in
        // this version, and a malformed block must be ignored rather than
        // trusted into the upload path.
        const parsed = columnFileSchema.safeParse(column.file);
        if (parsed.success) byColumn.set(column.name, parsed.data);
      }
      if (attachments === null) {
        const raw = bodyOf(page.config)['attachments'];
        if (raw !== undefined && raw !== null) {
          const parsed = attachmentsSchema.safeParse(raw);
          // `enabled: false` is how an operator turns the panel off without
          // losing the rest of the configuration — it is not an enabled block.
          //
          // A block naming a `column` is COLUMN mode (38 D14): its files live
          // in the customer's table and its caps belong to the column block, so
          // it is not a sidecar and must not be reported as one.
          if (parsed.success && parsed.data.enabled && parsed.data.column === undefined) {
            attachments = parsed.data;
          }
        }
      }
    }
    const blocks: ColumnFileBlocks = { byColumn, attachments };
    cache.set(key, { at: now(), blocks });
    return blocks;
  }

  return {
    forTable,
    async forColumn({ connectionId, table, column }) {
      return (await forTable(connectionId, table)).byColumn.get(column) ?? null;
    },
    async attachmentsFor(connectionId, table) {
      return (await forTable(connectionId, table)).attachments;
    },
    clear() {
      cache.clear();
    },
  };
}
