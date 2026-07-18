import { z } from 'zod';

/**
 * The normalized schema model (the IR) — 05-introspection-engine.md §2.
 *
 * One model for everything: live introspection, every schema-import parser,
 * the LLM round-trip, snapshots, and the generator all speak this shape.
 * TypeScript types are `z.infer<>` of the Zod schemas below — never
 * hand-duplicated. All objects are strict so unknown keys fail loudly, and
 * every value is JSON-native (no Dates, no undefined-bearing unions) because
 * the serialized model persists verbatim into
 * `adminium_schema_snapshots.model`.
 *
 * Minimal valid IR (§2.3): `irVersion`, `dialect: 'generic'`, `name`, one
 * table with one column — everything else has defaults so third-party
 * emitters stay small.
 */

export const IR_VERSION = 1 as const;

export const DIALECTS = ['postgres', 'mysql', 'sqlite', 'generic'] as const;
/** 'generic' = ORM import that doesn't pin a dialect. */
export const dialectSchema = z.enum(DIALECTS);
export type Dialect = z.infer<typeof dialectSchema>;

export const IMPORT_FORMATS = [
  'sql-ddl',
  'prisma',
  'drizzle',
  'typeorm',
  'sequelize',
  'rails',
  'django',
  'json-ir',
] as const;
export const importFormatSchema = z.enum(IMPORT_FORMATS);
export type ImportFormat = z.infer<typeof importFormatSchema>;

/** §2.2 — every adapter/parser maps native types onto this closed set. */
export const LOGICAL_TYPES = [
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
export const logicalTypeSchema = z.enum(LOGICAL_TYPES);
export type LogicalType = z.infer<typeof logicalTypeSchema>;

/** Where a model came from: a live connection or a schema import. */
export const modelSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('live'), connectionId: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('import'),
    format: importFormatSchema,
    fileName: z.string().min(1).optional(),
  }),
]);
export type ModelSource = z.infer<typeof modelSourceSchema>;

/**
 * Capability flags describing what the SOURCE could express (drives UI
 * degradation) — 05 §2.1 `AdapterCapabilities`. Adapters also expose these
 * statically per dialect; imports set them to what the format expresses.
 */
export const adapterCapabilitiesSchema = z.strictObject({
  /** Native enum types (pg) or column enums (mysql). */
  hasEnums: z.boolean().default(false),
  /** False per-table for MyISAM; false for Mongo later. */
  hasFKs: z.boolean().default(true),
  /** pg true; mysql/sqlite false. */
  hasSchemas: z.boolean().default(false),
  hasComments: z.boolean().default(false),
  hasChecks: z.boolean().default(false),
  hasRLS: z.boolean().default(false),
  hasMaterializedViews: z.boolean().default(false),
  hasRowEstimates: z.boolean().default(false),
  supportsStatementTimeout: z.boolean().default(false),
  /** pg/sqlite ≥ 3.35 true; mysql false (mutate re-selects). */
  supportsReturning: z.boolean().default(false),
  /** 63 pg, 64 mysql, 128 for sqlite/generic. */
  maxIdentifierLength: z.number().int().positive().default(128),
});
export type AdapterCapabilities = z.infer<typeof adapterCapabilitiesSchema>;
/** Workplan alias — several docs call these "capability flags". */
export const capabilityFlagsSchema = adapterCapabilitiesSchema;
export type CapabilityFlags = AdapterCapabilities;

/** §2.1 `EnumDef` — native = pg CREATE TYPE AS ENUM · column-type = MySQL enum(...) · check = CHECK (col IN (...)). */
export const enumDefSchema = z.strictObject({
  /** pg: `${schema}.${typname}`; mysql/check: `${tableId}.${column}`. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** Ordered; capped at 256 (adapters emit a warning beyond and truncate). */
  values: z.array(z.string()).min(1).max(256),
  source: z.enum(['native', 'column-type', 'check', 'import']).default('import'),
});
export type EnumDef = z.infer<typeof enumDefSchema>;

export const indexModelSchema = z.strictObject({
  name: z.string().min(1),
  /** Empty for pure expression indexes. */
  columns: z.array(z.string()).default([]),
  expression: z.string().nullable().default(null),
  unique: z.boolean().default(false),
  primary: z.boolean().default(false),
  /** 'btree', 'gin', … (pg); null elsewhere. */
  method: z.string().nullable().default(null),
  partial: z.boolean().default(false),
});
export type IndexModel = z.infer<typeof indexModelSchema>;

export const columnDefaultSchema = z
  .union([
    z.strictObject({ kind: z.enum(['literal', 'expression']), text: z.string() }),
    z.strictObject({ kind: z.enum(['autoincrement', 'now', 'uuid']) }),
  ])
  .nullable();
export type ColumnDefault = z.infer<typeof columnDefaultSchema>;

/**
 * §7 column semantic tags — one kebab-case id per §7.1 rule row, in
 * precedence order. Later docs and the LLM prompt reference these exact ids;
 * the classifier (classify/columns.ts, 05-T07) must emit only these.
 */
export const SEMANTIC_TAGS = [
  'secret',
  'pk-id',
  'fk',
  'money',
  'percent',
  'score',
  'status-workflow',
  'category-enum',
  'created-at',
  'updated-at',
  'date-range', // §7.1 row 11 "start/end pair" — pair roles carry start/end
  'event-timestamp',
  'duration',
  'geo-point', // §7.1 row 14 "geo-lat/lng" — pair roles carry lat/lng
  'geo-region',
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
export const semanticTagSchema = z.enum(SEMANTIC_TAGS);
export type SemanticTag = z.infer<typeof semanticTagSchema>;

/** §7.2 PII kinds — a flag layer independent of the primary semantic. */
export const PII_KINDS = [
  'email',
  'phone',
  'ip',
  'person-name',
  'address',
  'dob',
  'gov-id',
  'payment-id',
  'geo-precise',
] as const;
export const piiKindSchema = z.enum(PII_KINDS);
export type PiiKind = z.infer<typeof piiKindSchema>;

/** §7 `ColumnSemantics` — classifier output persisted with the model. */
export const columnSemanticsSchema = z.strictObject({
  primary: semanticTagSchema,
  flags: z.strictObject({
    secret: z.boolean().default(false),
    pii: piiKindSchema.nullable().default(null),
    maskedByDefault: z.boolean().default(false),
  }),
  /** Open set: 'currency' | 'percent' | 'duration' | 'relative-time' | 'filesize' | 'color-swatch' | 'mono' | … */
  format: z.string().nullable().default(null),
  pair: z
    .strictObject({
      role: z.enum(['start', 'end', 'lat', 'lng', 'poly-type', 'poly-id']),
      partner: z.string().min(1),
    })
    .nullable()
    .default(null),
  confidence: z.number().min(0).max(1),
  /** override (Studio remap / accepted LLM) always wins. */
  source: z.enum(['heuristic', 'llm', 'override']).default('heuristic'),
});
export type ColumnSemantics = z.infer<typeof columnSemanticsSchema>;

/** §8 `TableSemantics` — table-shape classifier output. */
export const TABLE_ROLES = [
  'entity',
  'join-table',
  'log',
  'people',
  'messages',
  'line-items',
  'system',
] as const;
export const tableRoleSchema = z.enum(TABLE_ROLES);
export type TableRole = z.infer<typeof tableRoleSchema>;

export const tableSemanticsSchema = z.strictObject({
  role: tableRoleSchema,
  /** Self-FK hierarchy (§6 rule 3) → tree/org-chart triggers. */
  hierarchy: z.strictObject({ parentColumn: z.string().min(1) }).nullable().default(null),
  /** §6 rule 4 — no Relation is fabricated for polymorphic pairs. */
  polymorphic: z
    .array(
      z.strictObject({
        typeColumn: z.string().min(1),
        idColumn: z.string().min(1),
        /** Filled only when the type column's enum/CHECK values match table names. */
        targets: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});
export type TableSemantics = z.infer<typeof tableSemanticsSchema>;

export const columnModelSchema = z.strictObject({
  name: z.string().min(1),
  /** 1-based position (pg attnum-style); 0 = unspecified (imports). */
  ordinal: z.number().int().nonnegative().default(0),
  /** Verbatim native type, e.g. 'character varying(120)', "enum('a','b')". */
  dbType: z.string().default('text'),
  logicalType: logicalTypeSchema.default('text'),
  nullable: z.boolean().default(true),
  default: columnDefaultSchema.default(null),
  isPrimaryKey: z.boolean().default(false),
  /** Covered by a single-column unique constraint/index. */
  isUnique: z.boolean().default(false),
  /** Computed/stored generated column. */
  isGenerated: z.boolean().default(false),
  /** EnumDef.id when logicalType='enum'. */
  enumRef: z.string().nullable().default(null),
  maxLength: z.number().int().positive().nullable().default(null),
  numericPrecision: z.number().int().nonnegative().nullable().default(null),
  numericScale: z.number().int().nonnegative().nullable().default(null),
  isArray: z.boolean().default(false),
  comment: z.string().nullable().default(null),
  /** Convenience mirror of the declared FK relation. */
  references: z
    .strictObject({ tableId: z.string().min(1), column: z.string().min(1) })
    .nullable()
    .default(null),
  /** Classifier output (§7); null until classification runs. */
  semantics: columnSemanticsSchema.nullable().default(null),
});
export type ColumnModel = z.infer<typeof columnModelSchema>;

const tableModelBaseSchema = z.strictObject({
  /** `${schema}.${name}` — stable key used by overrides/pages. Derived when omitted. */
  id: z.string().min(1).optional(),
  schema: z.string().min(1).default('public'),
  name: z.string().min(1),
  /**
   * Effective display label (Studio remap `table.label` / accepted LLM
   * `llm.label`, provenance user > llm > heuristic). Never emitted by
   * introspection — snapshots stay label-free; the server overlays it onto
   * the parsed model before generation so title fallbacks read
   * `table.label ?? humanize(table.name)`. Absent ⇔ heuristic naming.
   */
  label: z.string().min(1).optional(),
  kind: z.enum(['table', 'view', 'materialized-view']).default('table'),
  comment: z.string().nullable().default(null),
  columns: z.array(columnModelSchema).min(1),
  /** Ordered column names; [] = no PK (table becomes read-only). */
  primaryKey: z.array(z.string()).default([]),
  uniques: z
    .array(z.strictObject({ name: z.string().nullable(), columns: z.array(z.string()).min(1) }))
    .default([]),
  checks: z
    .array(z.strictObject({ name: z.string().nullable(), expression: z.string().min(1) }))
    .default([]),
  indexes: z.array(indexModelSchema).default([]),
  /** ESTIMATE only during setup; null = unknown. Never COUNT at setup. */
  rowCountEstimate: z.number().int().nonnegative().nullable().default(null),
  /** True only for SQLite small-file exact counts. */
  rowCountExact: z.boolean().default(false),
  sizeBytes: z.number().int().nonnegative().nullable().default(null),
  /** pg_stat_user_tables; null elsewhere. */
  activity: z
    .strictObject({
      inserts: z.number().int().nonnegative(),
      updates: z.number().int().nonnegative(),
      deletes: z.number().int().nonnegative(),
    })
    .nullable()
    .default(null),
  /** Postgres only. */
  rls: z
    .strictObject({
      enabled: z.boolean(),
      forced: z.boolean(),
      policyCount: z.number().int().nonnegative(),
    })
    .nullable()
    .default(null),
  /** Migration/meta tables (adminium_*, _prisma_migrations, …). */
  system: z.boolean().default(false),
  /** Table-shape classifier output (§8); null until classification runs. */
  semantics: tableSemanticsSchema.nullable().default(null),
});

export const tableModelSchema = tableModelBaseSchema.transform((table) => ({
  ...table,
  id: table.id ?? `${table.schema}.${table.name}`,
}));
export type TableModel = z.output<typeof tableModelSchema>;

export const FK_ACTIONS = ['cascade', 'restrict', 'set-null', 'set-default', 'no-action'] as const;
export const fkActionSchema = z.enum(FK_ACTIONS);
export type FkAction = z.infer<typeof fkActionSchema>;

export const RELATION_KINDS = [
  'declared-fk',
  'inferred-name',
  'inferred-join-table',
  'override',
  'manifest',
] as const;
export const relationKindSchema = z.enum(RELATION_KINDS);
export type RelationKind = z.infer<typeof relationKindSchema>;

export const CARDINALITIES = ['one-to-one', 'one-to-many', 'many-to-many'] as const;
export const cardinalitySchema = z.enum(CARDINALITIES);
export type Cardinality = z.infer<typeof cardinalitySchema>;

const relationEndpointSchema = z.strictObject({
  tableId: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1),
});
export type RelationEndpoint = z.infer<typeof relationEndpointSchema>;

/** §2.1 `Relation` — declared + inferred + overrides, deduped. */
export const relationSchema = z.strictObject({
  /** Stable hash (or readable key) of kind+from+to. */
  id: z.string().min(1),
  kind: relationKindSchema,
  cardinality: cardinalitySchema,
  /** FK side ("many" side for 1:N). */
  from: relationEndpointSchema,
  /** Referenced side. */
  to: relationEndpointSchema,
  /** M2M join table. */
  through: z
    .strictObject({
      tableId: z.string().min(1),
      fromColumns: z.array(z.string().min(1)).min(1),
      toColumns: z.array(z.string().min(1)).min(1),
    })
    .nullable()
    .default(null),
  onDelete: fkActionSchema.nullable().default(null),
  onUpdate: fkActionSchema.nullable().default(null),
  selfReferential: z.boolean().default(false),
  /** 1.0 declared/override; <1 inferred (§6 thresholds). */
  confidence: z.number().min(0).max(1).default(1),
});
export type Relation = z.infer<typeof relationSchema>;

/** Non-fatal issues: skipped statements, capped enums, permission gaps. */
export const modelWarningSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  /** Table the warning concerns, when applicable. */
  tableId: z.string().nullable().default(null),
});
export type ModelWarning = z.infer<typeof modelWarningSchema>;

export const modelStatsSchema = z.strictObject({
  tableCount: z.number().int().nonnegative().default(0),
  columnCount: z.number().int().nonnegative().default(0),
  relationCount: z.number().int().nonnegative().default(0),
  durationMs: z.number().nonnegative().default(0),
});
export type ModelStats = z.infer<typeof modelStatsSchema>;

const databaseModelBaseSchema = z.strictObject({
  irVersion: z.literal(IR_VERSION).default(IR_VERSION),
  dialect: dialectSchema,
  source: modelSourceSchema.default({ kind: 'import', format: 'json-ir' }),
  /** Database name or import file stem. */
  name: z.string().min(1),
  /** 'public' | <db name> | 'main'. */
  defaultSchema: z.string().min(1).default('public'),
  /** ['public'] when hasSchemas=false. */
  schemas: z.array(z.string().min(1)).min(1).default(['public']),
  tables: z.array(tableModelSchema),
  enums: z.array(enumDefSchema).default([]),
  /** Declared + inferred + overrides, deduped. */
  relations: z.array(relationSchema).default([]),
  capabilities: adapterCapabilitiesSchema.prefault({}),
  /** ISO 8601. */
  introspectedAt: z.iso
    .datetime({ offset: true })
    .default(() => new Date().toISOString()),
  stats: modelStatsSchema.prefault({}),
  warnings: z.array(modelWarningSchema).default([]),
});

/**
 * Cross-reference integrity: relations, FK mirrors, enum refs, and primary
 * keys must point at tables/columns/enums that exist in the model. Runs on
 * every parse so a snapshot can never persist dangling references.
 */
export const databaseModelSchema = databaseModelBaseSchema.superRefine((model, ctx) => {
  const tables = new Map<string, Set<string>>();
  for (const [i, table] of model.tables.entries()) {
    if (tables.has(table.id)) {
      ctx.addIssue({
        code: 'custom',
        message: `duplicate table id "${table.id}"`,
        path: ['tables', i, 'id'],
      });
    }
    tables.set(table.id, new Set(table.columns.map((c) => c.name)));
  }
  const enumIds = new Set(model.enums.map((e) => e.id));

  const requireColumns = (
    tableId: string,
    columns: readonly string[],
    path: (string | number)[],
  ): void => {
    const known = tables.get(tableId);
    if (!known) {
      ctx.addIssue({ code: 'custom', message: `unknown table "${tableId}"`, path });
      return;
    }
    for (const column of columns) {
      if (!known.has(column)) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown column "${column}" on table "${tableId}"`,
          path,
        });
      }
    }
  };

  for (const [i, table] of model.tables.entries()) {
    requireColumns(table.id, table.primaryKey, ['tables', i, 'primaryKey']);
    for (const [j, column] of table.columns.entries()) {
      if (column.references !== null) {
        requireColumns(column.references.tableId, [column.references.column], [
          'tables',
          i,
          'columns',
          j,
          'references',
        ]);
      }
      if (column.enumRef !== null && !enumIds.has(column.enumRef)) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown enum "${column.enumRef}"`,
          path: ['tables', i, 'columns', j, 'enumRef'],
        });
      }
    }
  }

  const relationIds = new Set<string>();
  for (const [i, relation] of model.relations.entries()) {
    if (relationIds.has(relation.id)) {
      ctx.addIssue({
        code: 'custom',
        message: `duplicate relation id "${relation.id}"`,
        path: ['relations', i, 'id'],
      });
    }
    relationIds.add(relation.id);
    requireColumns(relation.from.tableId, relation.from.columns, ['relations', i, 'from']);
    requireColumns(relation.to.tableId, relation.to.columns, ['relations', i, 'to']);
    if (relation.through !== null) {
      requireColumns(
        relation.through.tableId,
        [...relation.through.fromColumns, ...relation.through.toColumns],
        ['relations', i, 'through'],
      );
    }
  }
});

export type DatabaseModel = z.output<typeof databaseModelSchema>;

/**
 * Workplan aliases: the milestone plan and several sibling docs refer to the
 * IR as `SchemaModel` (e.g. 01-architecture.md §2.3 "interface + SchemaModel
 * types"). Same schema, same type.
 */
export const schemaModelSchema = databaseModelSchema;
export type SchemaModel = DatabaseModel;

/**
 * Single entry point used by the JSON IR importer, the LLM response
 * validator (06-llm-assist.md), and snapshot loading. Accepts a parsed JSON
 * value or a JSON string. Throws ZodError (or SyntaxError for bad JSON).
 */
export function parseDatabaseModel(json: unknown): DatabaseModel {
  const value: unknown = typeof json === 'string' ? JSON.parse(json) : json;
  return databaseModelSchema.parse(value);
}

/** Alias of {@link parseDatabaseModel} under the `SchemaModel` naming. */
export const parseSchemaModel = parseDatabaseModel;
