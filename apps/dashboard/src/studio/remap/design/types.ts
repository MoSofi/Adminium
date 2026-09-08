// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Design mode's wire types — 35-schema-authoring.md §3.1, §3.2.
 *
 * Mirrored from the engine rather than imported: `apps/dashboard` cannot
 * depend on `@adminium/engine` for anything but its published types, and this
 * file is what the SERVER's route contract looks like from the client's side.
 * Keeping it separate is also what stops a UI convenience field from
 * accidentally becoming part of the authored document — the body is a
 * `strictObject` at the route, so an extra key here is a 422 there.
 */

/** The fourteen types D30 admits. */
export const AUTHORABLE_TYPES = [
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
  'uuid',
  'json',
  'enum',
] as const;
export type AuthorableType = (typeof AUTHORABLE_TYPES)[number];

export type DesiredDefault =
  | { kind: 'literal'; text: string }
  | { kind: 'now' | 'uuid' | 'autoincrement' }
  | null;

export interface DesiredColumn {
  name: string;
  logicalType: AuthorableType;
  nullable: boolean;
  default: DesiredDefault;
  maxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
  comment: string | null;
}

export type FkAction = 'cascade' | 'restrict' | 'set-null' | 'set-default' | 'no-action';

export interface DesiredForeignKey {
  name: string | null;
  columns: string[];
  toTable: string;
  toColumns: string[];
  onDelete: FkAction | null;
  onUpdate: FkAction | null;
}

export interface DesiredTable {
  id: string | null;
  schema: string | null;
  name: string;
  comment: string | null;
  columns: DesiredColumn[];
  primaryKey: string[];
  uniques: { name: string | null; columns: string[] }[];
  indexes: { name: string | null; columns: string[]; unique: boolean }[];
  foreignKeys: DesiredForeignKey[];
  enumValues: Record<string, string[]>;
}

/**
 * Add one column to a table that already exists
 * (38-files-library-and-attachments.md D6).
 *
 * The narrow door, for a caller that holds a snapshot rather than the
 * designer's buffer: restating a whole table through {@link SchemaEdit.upsertTables}
 * silently loses any column type this vocabulary cannot name and any default it
 * cannot author. The server builds the desired table from the SNAPSHOT plus
 * these columns, so nothing but the addition can be planned.
 */
export interface AddColumn {
  /** Table id in the active snapshot. */
  table: string;
  column: DesiredColumn;
}

export interface SchemaEdit {
  baseSnapshotId: string;
  renames: {
    tables: { from: string; to: string }[];
    columns: { table: string; from: string; to: string }[];
  };
  upsertTables: DesiredTable[];
  /**
   * Optional on the wire (the server defaults it to `[]`), and optional here so
   * the designer — which only ever sends whole tables — is unchanged.
   */
  addColumns?: AddColumn[];
  dropTables: string[];
}

/** D4's hazard vocabulary, as the review screen renders it. */
export type Hazard = 'safe' | 'locking' | 'rewrite' | 'lossy' | 'irreversible' | 'refused';

export interface Consequence {
  kind: string;
  message: string;
  refs: string[];
}

export interface PlanStep {
  id: string;
  kind: string;
  table: string;
  column: string | null;
  hazard: Hazard;
  requiresSuperAdmin: boolean;
  summary: string;
  rationale: string;
  consequences: Consequence[];
  dependsOn: string[];
  outsideTransaction: boolean;
  refusal: string | null;
  /** The exact statements — D2's invariant, at the wire. */
  sql: string[];
}

export interface SchemaPlan {
  steps: PlanStep[];
  refusals: { code: string; message: string; table: string | null; column: string | null }[];
  warnings: { message: string; table: string | null }[];
  hazard: Hazard;
  requiresSuperAdmin: boolean;
  checksum: string;
  /**
   * Tables the row ceiling gates, and whether this viewer can open the gate
   * (D18). Plan-LEVEL because a ceiling is a fact about a table — and because a
   * field added to a refusal object is silently dropped by the server's
   * response serializer, so it would exist on the server and never arrive here.
   */
  ceilings: {
    table: string;
    rows: number;
    capped: boolean;
    acknowledged: boolean;
    openable: boolean;
  }[];
  /** A previous apply that never reported an outcome (35-T36). */
  unfinished: { id: string; startedAt: number } | null;
}

export interface ApplyResult {
  changeId: string;
  status: 'applied' | 'partial' | 'failed';
  steps: {
    id: string;
    kind: string;
    table: string;
    column: string | null;
    hazard: string;
    outcome: 'pending' | 'succeeded' | 'failed' | 'skipped';
    sql: string[];
    error: string | null;
    durationMs: number | null;
  }[];
  error: string | null;
  /** The re-introspection the apply ran for itself (D11); null when nothing succeeded. */
  snapshotId: string | null;
  /** D33's meta-store repair after a rename; null when nothing was renamed. */
  repaired: {
    pages: number;
    grants: number;
    overrides: number;
    includedTables: number;
    diagramLayout: number;
  } | null;
  /** Tables this apply created — the inclusion offer's subject (D11). */
  createdTables: string[];
}

/** What `POST …/schema/adopt` reports back (D11's last beat). */
export interface AdoptResult {
  included: string[];
  includesEverything: boolean;
  snapshotId: string;
  pages: number;
  result: {
    created: number;
    updated: number;
    unchanged: number;
    pruned: number;
    skippedEdited: string[];
    keptEdited: string[];
  };
}
