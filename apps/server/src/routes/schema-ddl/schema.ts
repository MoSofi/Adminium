// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for `routes/schema-ddl/` — 35-schema-authoring.md §3.5, 35-T10.
 *
 * The request body is the engine's `SchemaEdit`, mirrored here rather than
 * imported: a route's wire contract is the route's, and `strictObject` at this
 * boundary is what makes D30's closed vocabulary a 422 at the gate instead of
 * a validation error three layers in (§3.1 — "a body carrying them is a 422 at
 * the Zod gate, before validation runs").
 */
import { z } from 'zod';

export const ddlConnParams = z.object({ id: z.string().min(1) });

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_]*$/, 'must match ^[a-z][a-z0-9_]*$');

const desiredDefault = z
  .union([
    z.strictObject({ kind: z.literal('literal'), text: z.string() }),
    z.strictObject({ kind: z.enum(['now', 'uuid', 'autoincrement']) }),
  ])
  .nullable();

const desiredColumn = z.strictObject({
  name: identifier,
  logicalType: z.enum([
    'text', 'varchar', 'integer', 'bigint', 'decimal', 'float', 'boolean',
    'date', 'time', 'timestamp', 'timestamptz', 'uuid', 'json', 'enum',
  ]),
  nullable: z.boolean().default(true),
  default: desiredDefault.default(null),
  maxLength: z.number().int().positive().max(65_535).nullable().default(null),
  numericPrecision: z.number().int().min(1).max(65).nullable().default(null),
  numericScale: z.number().int().min(0).max(30).nullable().default(null),
  comment: z.string().max(1024).nullable().default(null),
});

const constraint = z.strictObject({
  name: identifier.nullable().default(null),
  columns: z.array(identifier).min(1),
});

const fkAction = z.enum(['cascade', 'restrict', 'set-null', 'set-default', 'no-action']);

const desiredTable = z.strictObject({
  id: z.string().min(1).nullable().default(null),
  schema: z.string().min(1).nullable().default(null),
  name: identifier,
  comment: z.string().max(1024).nullable().default(null),
  columns: z.array(desiredColumn).min(1).max(500),
  primaryKey: z.array(identifier).default([]),
  uniques: z.array(constraint).default([]),
  indexes: z.array(constraint.extend({ unique: z.boolean().default(false) })).default([]),
  foreignKeys: z
    .array(
      z.strictObject({
        name: identifier.nullable().default(null),
        columns: z.array(identifier).min(1),
        toTable: z.string().min(1),
        toColumns: z.array(identifier).min(1),
        onDelete: fkAction.nullable().default(null),
        onUpdate: fkAction.nullable().default(null),
      }),
    )
    .default([]),
  enumValues: z.record(z.string(), z.array(z.string().min(1)).min(1).max(256)).default({}),
});

/**
 * D18's ceiling acknowledgement: the tables the operator authorised past the
 * row ceiling by typing each table's own name.
 *
 * Table ids, not step ids. A ceiling is a fact about a TABLE, one table can
 * gate several steps in the same plan, and a step id is positional — it moves
 * when the plan changes, so an acknowledgement keyed to one would stop matching
 * after any edit without saying why.
 *
 * Accepted on the PLAN body as well as on apply, deliberately: the plan the
 * operator authorises must be the plan that runs (D2). A door opened only at
 * apply produced a different plan — a refused step compiles to no SQL — and
 * `SCHEMA_DRIFT` fired before the door could be consulted.
 */
const ceilingAcknowledgement = z.array(z.string().min(1)).max(100).default([]);

export const schemaEditBody = z.strictObject({
  baseSnapshotId: z.string().min(1),
  acknowledgeCeiling: ceilingAcknowledgement,
  renames: z
    .strictObject({
      tables: z.array(z.strictObject({ from: z.string().min(1), to: identifier })).default([]),
      columns: z
        .array(z.strictObject({ table: z.string().min(1), from: identifier, to: identifier }))
        .default([]),
    })
    .default({ tables: [], columns: [] }),
  upsertTables: z.array(desiredTable).max(100).default([]),
  /**
   * Add columns to tables that already exist, without restating them
   * (38-files-library-and-attachments.md D6).
   *
   * The narrow door: a caller that holds only a snapshot cannot restate a real
   * table faithfully through `upsertTables` — `logicalType` is a closed enum,
   * so one display-only column type makes the whole request invalid, and a
   * default this vocabulary cannot author comes back `null` and reads as an
   * intentional drop. See `addColumnSchema` in `@adminium/engine` for the full
   * argument; the planner builds the desired table from the SNAPSHOT plus
   * these columns, so nothing else can move.
   */
  addColumns: z
    .array(z.strictObject({ table: z.string().min(1), column: desiredColumn }))
    .max(50)
    .default([]),
  dropTables: z.array(z.string().min(1)).max(100).default([]),
});

export const applyBody = schemaEditBody.extend({
  /** The plan being authorised (D2); a mismatch is `SCHEMA_DRIFT`. */
  checksum: z.string().min(1),
  /**
   * D18's acknowledgement door: the operator has SEEN the row count for every
   * rewriting step. Absent means the plan is applied only if it warns about
   * none — a confirmation the UI collects, never a default the API assumes.
   */
  acknowledgeRows: z.boolean().default(false),
});

const consequence = z.object({
  kind: z.string(),
  message: z.string(),
  refs: z.array(z.string()),
});

const step = z.object({
  id: z.string(),
  kind: z.string(),
  table: z.string(),
  column: z.string().nullable(),
  hazard: z.string(),
  requiresSuperAdmin: z.boolean(),
  summary: z.string(),
  rationale: z.string(),
  consequences: z.array(consequence),
  dependsOn: z.array(z.string()),
  outsideTransaction: z.boolean(),
  refusal: z.string().nullable(),
  /** The exact statements — the D2 preview IS what runs. */
  sql: z.array(z.string()),
});

export const planReply = z.object({
  steps: z.array(step),
  refusals: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      table: z.string().nullable(),
      column: z.string().nullable(),
    }),
  ),
  /**
   * D18: the tables the row ceiling gates, and whether this viewer could open
   * the gate. Declared HERE because Fastify's response serializer drops any
   * property the schema does not name — a field added to a refusal object would
   * exist on the server, pass every server test, and never reach the browser.
   */
  ceilings: z.array(
    z.object({
      table: z.string(),
      rows: z.number(),
      capped: z.boolean(),
      acknowledged: z.boolean(),
      openable: z.boolean(),
    }),
  ),
  warnings: z.array(z.object({ message: z.string(), table: z.string().nullable() })),
  hazard: z.string(),
  requiresSuperAdmin: z.boolean(),
  checksum: z.string(),
  /** A previous apply that never reported an outcome (35-T36). */
  unfinished: z.object({ id: z.string(), startedAt: z.number() }).nullable(),
});

export const applyReply = z.object({
  changeId: z.string(),
  status: z.enum(['applied', 'partial', 'failed']),
  steps: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      table: z.string(),
      column: z.string().nullable(),
      hazard: z.string(),
      outcome: z.enum(['pending', 'succeeded', 'failed', 'skipped']),
      sql: z.array(z.string()),
      error: z.string().nullable(),
      durationMs: z.number().nullable(),
    }),
  ),
  error: z.string().nullable(),
  /**
   * D11's first two beats, reported rather than assumed.
   *
   * `snapshotId` is the re-introspection the apply ran for itself: without it
   * the schema tree, the diagram and every page binding still describe the
   * database as it was BEFORE the change, and the operator is told to go
   * re-introspect a thing Adminium already knows it changed. Null when no step
   * succeeded — there is nothing new to read.
   *
   * `repaired` is D33's meta-store repair (which tables, pages, grants and
   * override rows followed a rename). It was computed and thrown away by this
   * schema until it was named here.
   */
  snapshotId: z.string().nullable(),
  repaired: z
    .object({
      pages: z.number(),
      grants: z.number(),
      overrides: z.number(),
      includedTables: z.number(),
      diagramLayout: z.number(),
    })
    .nullable(),
  /**
   * D11's third beat: tables this apply CREATED, so the surface can offer
   * inclusion. A created table is invisible until it is in `includedTables` and
   * a page has been generated for it — offering that is the difference between
   * a feature and a DDL console.
   */
  createdTables: z.array(z.string()),
});

/**
 * D11's adoption step — `POST /connections/:id/schema/adopt`.
 *
 * Separate from apply on purpose. Apply is the dangerous half and is gated on
 * `schema.ddl`; adoption regenerates pages and is exactly what
 * `POST /connections/:id/generate` does, so it carries that route's grant. An
 * operator who can change the schema but not the app gets the tables and an
 * honest sentence about who can finish the job.
 */
export const adoptBody = z.strictObject({
  tables: z.array(z.string().min(1)).min(1).max(100),
});

export const adoptReply = z.object({
  /** Tables newly added to `settings.includedTables` by this call. */
  included: z.array(z.string()),
  /** True when the connection includes every table and nothing had to be added. */
  includesEverything: z.boolean(),
  snapshotId: z.string(),
  pages: z.number(),
  result: z.object({
    created: z.number(),
    updated: z.number(),
    unchanged: z.number(),
    pruned: z.number(),
    /** Pages a person had edited — regeneration left them exactly as they were. */
    skippedEdited: z.array(z.string()),
    keptEdited: z.array(z.string()),
  }),
});

export const changesReply = z.object({
  changes: z.array(
    z.object({
      id: z.string(),
      planChecksum: z.string(),
      status: z.string(),
      hazard: z.string(),
      error: z.string().nullable(),
      createdBy: z.string().nullable(),
      startedAt: z.number(),
      finishedAt: z.number().nullable(),
      stepCount: z.number(),
      succeeded: z.number(),
    }),
  ),
});

export const diagramLayoutBody = z.strictObject({
  /** `tableId → {x, y}`. Positions only; the diagram derives everything else. */
  positions: z.record(
    z.string().min(1),
    z.strictObject({ x: z.number(), y: z.number() }),
  ),
});

export const diagramLayoutReply = z.object({
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
});
