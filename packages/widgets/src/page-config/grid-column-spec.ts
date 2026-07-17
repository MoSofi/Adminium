import { z } from 'zod';

/**
 * Column-spec vocabulary for the `page-crud` config body — the typed
 * `config.columns[]` contract (research/widget-registry.md §3 "column defs
 * generated from schema"; 01-architecture.md §6.1 `config.columns`).
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

/** Logical column types the cell/form renderers branch on (engine §6 subset). */
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
 * Column semantics the renderers act on (engine §7.1 SEMANTIC_TAGS — kept as
 * an open string so classifier additions never break stored configs; the
 * known ids below get dedicated treatments, everything else renders as text).
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
 * crud generator and the LLM contract emit for enum values outside the §7.1
 * rule-7 keyword map ("inactive / draft / neutral"). Renderers map `'muted'`
 * onto the neutral treatment (`families/tables/cells.tsx`).
 */
export const gridToneSchema = z.enum(['neutral', 'accent', 'pos', 'warn', 'danger', 'info', 'muted']);
export type GridTone = z.infer<typeof gridToneSchema>;

/**
 * One column definition — the `config.columns[]` entry of `page-crud`
 * (01 §6.1) and the column contract of `data-grid`/`detail-key-value`/
 * `mini-table` (annex §3: `{key, label, type, mono, align, pill?, fk?}`).
 */
export const gridColumnSpecSchema = z.object({
  /** Snapshot column name — the row-object key. */
  name: z.string().min(1),
  /** Humanized header/label ("Monthly revenue"). */
  label: z.string().min(1),
  logicalType: gridLogicalTypeSchema.default('text'),
  /** Primary semantic tag from the classifier (engine §7.1 id). */
  semantic: z.string().nullable().default(null),
  /** Format hint ('currency' | 'percent' | 'relative-time' | 'mono' | …). */
  format: z.string().nullable().default(null),
  /** ISO currency for money columns (config.format.currency wins per-widget). */
  currency: z.string().optional(),
  /** Enum members, when logicalType='enum'. */
  enumValues: z.array(z.string()).optional(),
  /** enum value → tone map (01 §6.1 `enumTones`) — never hardcoded tints. */
  enumTones: z.record(z.string(), gridToneSchema).optional(),
  /** Outbound FK — cell renders the display value as an avatar chip. */
  fk: z
    .object({
      /** Referenced qualified table ("public.team_members"). */
      table: z.string().min(1),
      /** Referenced column (usually its PK). */
      column: z.string().min(1),
      /**
       * Row key carrying the pre-joined display value for the chip
       * (interpreter aliases the joined display column into the row).
       * Falls back to the raw FK value when absent.
       */
      displayKey: z.string().optional(),
    })
    .optional(),
  /** PII column — masked-by-default treatment ('•••' + unmask affordance). */
  pii: z.boolean().default(false),
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
  /** Unique index — the form runs the live uniqueness check (09 §7.1). */
  unique: z.boolean().default(false),
  /** Never editable (pk with default, created-at/updated-at, generated). */
  readOnly: z.boolean().default(false),
  maxLength: z.number().int().positive().nullable().default(null),
  /** The table's primary display column (09 §8.3 "key field" highlight). */
  isDisplay: z.boolean().default(false),
});

export type GridColumnSpec = z.infer<typeof gridColumnSpecSchema>;
export type GridColumnSpecInput = z.input<typeof gridColumnSpecSchema>;

export type GridRow = Record<string, unknown>;
