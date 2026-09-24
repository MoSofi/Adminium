// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { DERIVED_ALIAS_PATTERN } from './crud-derived.js';
import { WORKING_SCALE } from './decimal.js';

/**
 * Column-spec vocabulary for the `page-crud` config body — the typed
 * `config.columns[]` contract (research/widget-registry.md;
 * `config.columns`).
 *
 * Lives in the page-config leaf (not `families/tables`) because it is a stored
 * config-body schema, not component code: the generator leaf's crud-body
 * composer (`../generate/crud-body.ts`) emits these specs and may import only
 * zod + this leaf, and `@adminium/engine/config` bundles this leaf for the
 * server. `families/tables/column-spec.ts` re-exports everything here — the
 * renderers and their i18n-backed cell formatters stay there — so there is ONE
 * schema and ONE type on both sides of the boundary.
 *
 * These mirror the Engine snapshot's `ColumnModel` + `ColumnSemantics`
 * vocabulary (packages/engine/src/schema-model.ts) WITHOUT importing the
 * engine — @adminium/widgets may only touch the browser-safe
 * `@adminium/engine/config` leaf, and that leaf itself imports widgets'
 * page-config, so the spec types live here and the interpreter (dashboard)
 * projects snapshot columns into them.
 */

/** Logical column types the cell/form renderers branch on (engine subset). */
export const GRID_LOGICAL_TYPES = [
  'text',
  'varchar',
  'integer',
  'bigint',
  'decimal',
  'float',
  'boolean',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'interval',
  'uuid',
  'json',
  'binary',
  'enum',
  'geometry',
  'inet',
  'unknown',
] as const;
export const gridLogicalTypeSchema = z.enum(GRID_LOGICAL_TYPES);
export type GridLogicalType = z.infer<typeof gridLogicalTypeSchema>;

/**
 * Column semantics the renderers act on (engine SEMANTIC_TAGS — kept as an
 * open string so classifier additions never break stored configs; the known
 * ids below get dedicated treatments, everything else renders as text).
 */
export const GRID_SEMANTICS = [
  'pk-id',
  'fk',
  'money',
  'percent',
  'score',
  'status-workflow',
  'category-enum',
  'created-at',
  'updated-at',
  'event-timestamp',
  'duration',
  'person-name',
  'email',
  'phone',
  'image-url',
  'file-ref',
  'url',
  'boolean-flag',
  'color',
  'tags',
  'slug',
  'ip-address',
  'json-config',
  'external-id',
  'free-text',
  'plain',
] as const;
export type GridSemantic = (typeof GRID_SEMANTICS)[number] | (string & {});

/**
 * The `@adminium/ui` tone vocabulary plus `'muted'` — the fallback tone the
 * crud generator and the LLM contract emit for enum values outside the
 * rule-7 keyword map ("inactive / draft / neutral"). Renderers map `'muted'`
 * onto the neutral treatment (`families/tables/cells.tsx`).
 */
export const gridToneSchema = z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info', 'muted']);
export type GridTone = z.infer<typeof gridToneSchema>;

/**
 * Explicit presentation kinds a column may opt into.
 *
 * Small and closed on purpose: each one is a branch in the cell renderer with
 * its own alignment, its own formatter and its own baseline.
 */
export const COLUMN_DISPLAY_KINDS = ['currency', 'percent', 'decimal', 'integer'] as const;
export type ColumnDisplayKind = (typeof COLUMN_DISPLAY_KINDS)[number];

/**
 * How to render THIS column's value — an opt-in override of the semantic
 * chain.
 *
 * WHY A NEW BLOCK RATHER THAN READING THE EXISTING `format`. `column.format`
 * is written by the generator on every page already and read by zero
 * renderers, so teaching a cell to honour it would change the appearance of
 * every stored page and move byte-pinned baselines. An opt-in block, by
 * construction, changes nothing that is not opted in.
 *
 * WHY ON EVERY COLUMN AND NOT ONLY DERIVED ONES. A derived value needs it (it
 * has no useful `semantic` or `logicalType` and would otherwise render as a
 * bare mono string), but the same block is also the only in-scope repair for a
 * MIS-CLASSIFIED physical column — a `numeric(12,2)` unit price called `rate`
 * classifies as a percent and renders `1533%` — and it repairs it per column,
 * without touching the classifier and re-recording its byte-pinned baseline.
 */
export const columnDisplaySchema = z
  .object({
    kind: z.enum(COLUMN_DISPLAY_KINDS),
    /**
     * ISO-4217, for `kind: 'currency'`. Ranked ABOVE the connection's own
     * currency, which is ranked above the `'USD'` fallback — so a per-column
     * override exists for the mixed-currency table without making every page
     * declare one.
     */
    currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
    /**
     * Fraction digits, always exactly this many. Capped at the arithmetic's
     * own working width — a column cannot display more digits than the value
     * carries.
     */
    decimals: z.number().int().min(0).max(WORKING_SCALE).optional(),
    /**
     * REQUIRED for `kind: 'percent'`, and the reason this block exists at all
     * for percents: `8` means 8% in a 0-100 `tax_rate` column and 800% in a
     * 0-1 ratio column, and guessing wrong is a 100x error on screen. The
     * classifier already distinguishes the two and throws the information
     * away; this is where it is finally stated (D9).
     */
    percentScale: z.enum(['unit', 'fraction']).optional(),
  })
  .refine((value) => value.kind !== 'percent' || value.percentScale !== undefined, {
    error: "`display.percentScale` is required when kind is 'percent'.",
    path: ['percentScale'],
  });
export type ColumnDisplay = z.infer<typeof columnDisplaySchema>;

/**
 * One column definition — the `config.columns[]` entry of `page-crud`
 * and the column contract of `data-grid`/`detail-key-value`/
 * `mini-table` (annex: `{key, label, type, mono, align, pill?, fk?}`).
 */
/**
 * The reference shapes a file column may store. `url` is the default and
 * what generation seeds (D31).
 */
export const COLUMN_FILE_REFS = ['url', 'id', 'key'] as const;
export type ColumnFileRef = (typeof COLUMN_FILE_REFS)[number];

/**
 * This column holds a FILE, not a string that happens to look like
 * one.
 *
 * WHY AN OPT-IN BLOCK AND NOT A SEMANTIC TAG. The classifier already tags
 * `file-ref` and `image-url` columns, and has since M5 — those tags are
 * written onto every generated page and drive a bare `<a>` today. Teaching the
 * cell renderer to honour the TAG would change how every stored page renders,
 * including pages a person has edited, and would move byte-pinned VRT
 * baselines for tables nobody asked to change. The same argument
 * `columnDisplaySchema` makes, for the same reason: an opt-in block changes
 * nothing that is not opted in (the rule).
 *
 * Generation SEEDS the block on NEW pages for `file-ref` / `image-url`
 * columns, so a freshly generated app gets upload affordances without anybody
 * configuring one; a page that already exists keeps rendering exactly as it
 * did until an operator turns it on in the ColumnManager.
 *
 * THE COLUMN MUST BE TEXT. A `json` column holding an array is O5 (refused in
 * v1); a `binary` column is bytes inside the customer's database, which is a
 * different feature and stays a "binary, N bytes" cell.
 */
export const columnFileSchema = z
  .object({
    /**
     * What gets WRITTEN into the customer's column. The server accepts all
     * three on read plus foreign links, so changing this does not invalidate
     * values already stored — it only changes the next one.
     */
    ref: z.enum(COLUMN_FILE_REFS).default('url'),
    /**
     * Where new uploads for this column go. Absent = the workspace default,
     * which is what almost every column wants; naming one is for the table
     * whose files belong somewhere else (product photos on a CDN bucket while
     * everything else stays on the disk).
     */
    destinationId: z.string().min(1).optional(),
    /**
     * Narrow the workspace allowlist for THIS column — the keys from
     * `files.allowedTypes`. It can only ever narrow: a column naming a type the
     * workspace refuses would be a way to widen the security boundary from a
     * page config, and the server intersects rather than unions.
     */
    accept: z.array(z.string().min(1).max(20)).max(20).optional(),
    /** A per-column cap, below the workspace's `files.maxBytes`. */
    maxBytes: z.number().int().min(1024).optional(),
    /**
     * Render an image preview in the cell rather than a chip. Honoured only for
     * raster images under `files.thumbnailMaxBytes`, and always through the
     * same-origin content route — the dashboard's CSP is `default-src 'self'`,
     * so a cross-origin `<img>` is blocked whatever this says (D24).
     */
    inline: z.boolean().optional(),
    /**
     * This column holds a LIST of files rather than one
     * — the shape the Attachments card creates, and the shape a person means
     * by "attach the files".
     *
     * The value is a JSON array of references in this column's own `ref`
     * shape, stored in the same `text` column a single reference would use.
     * Not a `json` column: those are excluded from grids by `rankColumn` and
     * are not file-capable, and a text value is what keeps every existing
     * reader — the grid, a `SELECT`, a foreign app — working unchanged.
     *
     * Absent ⇒ exactly the single-value column 37 shipped.
     */
    multiple: z.boolean().optional(),
    /**
     * Refuse a write that would put more than this many files on one record.
     *
     * Enforced by the SERVER at write time, which is the only moment a
     * per-record count is knowable: a column upload for a record that does not
     * exist yet names no record. The form uses it to stop offering the control
     * once the list is full, which is courtesy rather than the boundary.
     */
    maxCount: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export type ColumnFile = z.infer<typeof columnFileSchema>;

export const gridColumnSpecSchema = z.object({
  /** Snapshot column name — the row-object key. */
  name: z.string().min(1),
  /** Humanized header/label ("Monthly revenue"). */
  label: z.string().min(1),
  logicalType: gridLogicalTypeSchema.default('text'),
  /** Primary semantic tag from the classifier (engine id). */
  semantic: z.string().nullable().default(null),
  /** Format hint ('currency' | 'percent' | 'relative-time' | 'mono' | …). */
  format: z.string().nullable().default(null),
  /** ISO currency for money columns (config.format.currency wins per-widget). */
  currency: z.string().optional(),
  /** Enum members, when logicalType='enum'. */
  enumValues: z.array(z.string()).optional(),
  /** enum value → tone map (`enumTones`) — never hardcoded tints. */
  enumTones: z.record(z.string(), gridToneSchema).optional(),
  /** enum value → the word a person reads ("Checked in" for `checked_in`). */
  enumLabels: z.record(z.string(), z.string()).optional(),
  /** Outbound FK — cell renders the display value as an avatar chip. */
  fk: z
    .object({
      /** Referenced qualified table ("public.team_members"). */
      table: z.string().min(1),
      /**
       * What a person calls the referenced table ("Categories") — its rename,
       * or the name its app installed — for the form's reference tag. Absent,
       * the tag shows `table`.
       */
      label: z.string().min(1).optional(),
      /** Referenced column (usually its PK). */
      column: z.string().min(1),
      /**
       * The referenced table's display COLUMN name ("company_name") — a
       * generation-time fact the crud composer stamps from the classifier's
       * display-column pick. The interpreter derives a `lookup=` param and a
       * `displayKey` from it ({@link fkDisplayAliasOf}), so the chip shows
       * "Drift & Fern" instead of the raw id. Optional: stored pages predate
       * it and simply keep the raw-value fallback until regenerated.
       */
      display: z.string().min(1).optional(),
      /**
       * Row key carrying the pre-joined display value for the chip
       * (interpreter aliases the joined display column into the row).
       * Falls back to the raw FK value when absent.
       */
      displayKey: z.string().optional(),
    })
    .optional(),
  /**
   * Cross-table lookup — this column's value is read from ANOTHER table by
   * following an outbound FK chain from the page's source table (the server's
   * `lookup=` param, apps/server/src/crud/lookups.ts). `name` is then a
   * synthetic alias the interpreter asks the server to project the value
   * under, not a source-table column: `path` is the FK column chain (each hop
   * a single-column FK of the table reached so far) and `select` the column of
   * the final referenced table to show. Lookup columns are projections —
   * never sortable server-side, never form fields.
   */
  lookup: z
    .object({
      path: z.array(z.string().min(1)).min(1).max(3),
      select: z.string().min(1),
    })
    .optional(),
  /**
   * Reverse-link aggregate — this column's value is computed over the rows of
   * ANOTHER table whose FK points at the page's source table (the server's
   * `agg=` param, apps/server/src/crud/aggregates.ts). `name` is a synthetic
   * alias the interpreter asks the server to project the value under:
   * `table` is the referencing table (qualified), `fkColumn` its FK onto the
   * source table, and `agg` the aggregate — `count` today, an open string so
   * future aggregates (`sum` …) never break stored configs. Reverse columns
   * are projections — never sortable server-side, never form fields.
   */
  reverse: z
    .object({
      table: z.string().min(1),
      fkColumn: z.string().min(1),
      agg: z.string().min(1),
    })
    .optional(),
  /**
   * Derived value — this column shows a page-level MEASURE or DERIVED FIELD
   * declared in `config.derived`. `name` is then a synthetic alias, and `ref`
   * names the definition to show.
   *
   * The definitions live at page level rather than here because the numbers
   * form a chain that several columns share (subtotal -> tax -> total ->
   * shipping), and no dialect permits a sibling SELECT alias inside one SELECT
   * list — so a per-column definition would re-derive the whole chain once per
   * consumer. Derived columns are projections: never sortable server-side,
   * never form fields.
   */
  derived: z
    .object({
      ref: z.string().regex(DERIVED_ALIAS_PATTERN),
    })
    .optional(),
  /**
   * Explicit presentation for this column — see {@link columnDisplaySchema}.
   * Absent on every generated page, and absence is exactly today's behaviour.
   */
  display: columnDisplaySchema.optional(),
  /**
   * This column holds a file — see {@link columnFileSchema}. Absent on every
   * page generated before 37, and absence is exactly today's behaviour: a bare
   * link in the grid and a `url` text input in the form.
   */
  file: columnFileSchema.optional(),
  /**
   * A widget from the project folder draws this column's cells:
   * `project.<file name>` for a `widgets/<file name>.tsx` of kind
   * `cell`. Absent on every generated page.
   *
   * Any non-empty string is kept, on purpose: an entry that fails this schema
   * is dropped with its whole column, and a mistyped id should cost the
   * custom drawing, not the column. A host that has no such widget draws the
   * value as usual and marks the cell; `adminium check` names the file and
   * the field.
   */
  widget: z.string().min(1).max(80).optional(),
  /**
   * Masked-by-default treatment ('•••' + unmask affordance).
   *
   * PRESENTATION ONLY, and the distinction is load-bearing. Whether the VALUE
   * reaches the browser is decided server-side from the connection's own
   * classification (`apps/server/src/crud/mask.ts` against the resolved
   * table's masked set) and the reader's unmask permission; a column masked
   * there arrives as `null` alongside a `_masked` marker and renders masked no
   * matter what this flag says. So turning this off cannot leak anything — the
   * value was already in the payload — and turning it on protects nothing.
   * It decides whether a reader who was sent the value has to click to see it.
   *
   * Generation seeds it from the classifier's `maskedByDefault`; the page
   * editor can flip it per column either way.
   */
  pii: z.boolean().default(false),
  /**
   * Draw a monogram avatar beside this column's value.
   *
   * TRI-STATE, because the sensible default is not the same everywhere and a
   * plain boolean would have to pick one and be wrong half the time:
   *
   * - absent on an FK column → ON. The chip has always drawn one, and an
   *   untouched page must keep looking as it did.
   * - absent anywhere else → OFF. Nothing else has ever drawn one.
   * - `true` / `false` → exactly that, on any column.
   *
   * Offered on EVERY column and not just the FK ones, because the column that
   * deserves a monogram is usually a person or company NAME — often a lookup
   * pulled across a relation — while the FK id column beside it usually
   * deserves none. Scoping the choice to FK columns offered it in the one
   * place it was least wanted.
   */
  avatar: z.boolean().optional(),
  /** JetBrains Mono value treatment (ids, amounts, emails). */
  mono: z.boolean().default(false),
  align: z.enum(['start', 'end']).optional(),
  sortable: z.boolean().default(true),
  /** Hidden from the grid but still available to forms/detail. */
  hidden: z.boolean().default(false),
  // --- form-generation facts (page-crud RecordForm) ------------------------
  primaryKey: z.boolean().default(false),
  nullable: z.boolean().default(true),
  /** Column has a DB default (serial/uuid/now) — omittable on create. */
  hasDefault: z.boolean().default(false),
  /** Unique index — the form runs the live uniqueness check. */
  unique: z.boolean().default(false),
  /** Never editable (pk with default, created-at/updated-at, generated). */
  readOnly: z.boolean().default(false),
  maxLength: z.number().int().positive().nullable().default(null),
  /** The table's primary display column (highlight). */
  isDisplay: z.boolean().default(false),
});

export type GridColumnSpec = z.infer<typeof gridColumnSpecSchema>;
export type GridColumnSpecInput = z.input<typeof gridColumnSpecSchema>;

export type GridRow = Record<string, unknown>;

/**
 * The server's `lookup=` alias grammar (apps/server/src/crud/lookups.ts
 * ALIAS_PATTERN) — aliases are row keys AND SQL aliases, so they stay boring.
 * Mirrored here because the FK-display derivation must refuse an alias the
 * server would 422 on, and the browser bundle cannot import server code.
 */
const LOOKUP_ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * The `displayKey` row alias for an FK column's pre-joined display value —
 * `client_id` → `client_id__display`. ONE derivation shared by the crud
 * composer (whose stamping pre-checks the alias against the source table's
 * real columns — a colliding alias is a hard 422 on every read) and the
 * dashboard interpreter (which turns `fk.display` into the actual `lookup=`
 * param). Returns null when the alias would break the server's grammar
 * (a 64-byte column name, exotic identifier characters) — callers skip the
 * display lookup and the chip keeps its raw-value fallback.
 */
export function fkDisplayAliasOf(columnName: string): string | null {
  const alias = `${columnName}__display`;
  return LOOKUP_ALIAS_PATTERN.test(alias) ? alias : null;
}
