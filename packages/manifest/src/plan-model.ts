// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install planner's shapes, on their own.
 *
 * Types only, so the planner (`plan.ts`), its context extension
 * (`plan-context.ts`) and the type rules (`plan-types.ts`) can all name them
 * without importing one another in a circle. `plan.ts` and `plan-context.ts`
 * re-export them, so every importer outside keeps its path.
 */

/** The existing database, as much of it as planning needs. */
export interface SchemaModelView {
  /** Every table name that already exists, however it got there. */
  tables: readonly {
    ref: string;
    columns: readonly ExistingColumnView[];
  }[];
  /**
   * The engine the tables live on. Only the type check reads it: SQLite
   * reports the installer's own `bool` as `integer` and its `money` as
   * `float`, which would be a conflict anywhere else. Absent, a type is judged
   * by the rules every engine shares.
   */
  dialect?: 'postgres' | 'mysql' | 'sqlite' | undefined;
}

/**
 * One existing column. Only `ref` is required; the rest is what the database
 * reports, and a caller that does not know it leaves it out. A column that
 * says nothing is never treated as required.
 */
export interface ExistingColumnView {
  ref: string;
  nullable?: boolean;
  /** The database fills it when an insert leaves it out (a default, a sequence). */
  hasDefault?: boolean;
  isPrimaryKey?: boolean;
  isGenerated?: boolean;
  /** The engine's logical type (`integer`, `varchar`, …). Absent = not judged. */
  logicalType?: string;
  /** A `varchar`'s width, when it has one. */
  maxLength?: number | null;
  /** A key the database numbers itself. Absent = unknown, never offered a repair. */
  isIdentity?: boolean;
  /** The values an enum column's CHECK (or native enum) admits, when it has one. */
  enumValues?: readonly string[];
}

/** What will happen to one table. */
export type TableAction = 'create' | 'reuse';

export interface PlannedColumn {
  ref: string;
  type: string;
  /** Absent from an existing table, so the install would have to add it. */
  missing: boolean;
}

export interface PlannedTable {
  ref: string;
  /** The real table name, when a plan context gave the table one (prefixed or recorded). */
  table?: string;
  action: TableAction;
  columns: PlannedColumn[];
  /**
   * Only on `reuse`: columns the manifest requires that the existing table does
   * not have. A non-empty list is a PARTIAL MATCH — the table is there but does
   * not carry what the add-on needs, which is a different situation from either
   * "create it" or "it fits", and the operator should be told which.
   */
  missingColumns: string[];
}

/** Where one declared foreign key ends up pointing. */
export interface PlannedReference {
  fromTable: string;
  fromColumn: string;
  to: string;
  /**
   * `internal` — the target is another table in this manifest.
   * `host` — the target already exists in the database (the add-on attaching to
   *   the host's data, which is the intended shape).
   * `unresolved` — the target exists nowhere, and the plan is not installable.
   */
  resolution: 'internal' | 'host' | 'unresolved';
}

/** A reason the plan cannot be applied, phrased for a person. */
export interface PlanProblem {
  code:
    | 'UNRESOLVED_REFERENCE'
    | 'COLUMN_TYPE_CONFLICT'
    | 'COLUMNS_REQUIRED'
    | 'RESERVED_TABLE'
    | 'FOREIGN_TABLE'
    // A context plan's own: a taken name waiting for an answer, a name too long
    // for the engine, two apps' prefixed names meeting.
    | 'TABLE_TAKEN'
    | 'IDENTIFIER_TOO_LONG'
    | 'PREFIX_COLLISION'
    // Added by the server, which can see the pages and read their forms.
    | 'PAGE_SLUG_TAKEN'
    | 'PAGE_FORM_INVALID'
    | 'ROLE_INVALID'
    // An email the app ships that the renderer cannot draw.
    | 'EMAIL_TEMPLATE_INVALID';
  message: string;
  table: string;
  column?: string;
}

export interface InstallPlan {
  /**
   * The manifest key this plan is for.
   *
   * Named `addOnKey` because add-ons were the only caller when it was written,
   * and left named that because the wire DTOs each route builds are where a
   * reader meets it — `routes/apps` spells it `key` on its own reply. Renaming
   * it here would churn three call sites and a shipped dialog for a field only
   * the server reads.
   */
  addOnKey: string;
  version: string;
  /** Tables to create, in declaration order (targets before dependents). */
  create: PlannedTable[];
  /** Tables that already exist and will be reused rather than created. */
  reuse: PlannedTable[];
  references: PlannedReference[];
  problems: PlanProblem[];
  /**
   * `true` when there is nothing standing in the way. A plan with problems is
   * still RETURNED — the consent dialog has to be able to show WHY an add-on
   * cannot be installed here, and an exception would leave it with nothing to
   * render.
   */
  installable: boolean;
  /** No `requiredSchema` at all: install touches no data source. */
  touchesData: boolean;
  /** With a plan context: each table's class, action, offers and edits. */
  tables?: InstallTablePlan[];
  /** With a plan context: short name → real table. */
  names?: Record<string, string>;
}

/** What the operator answered for one taken table. */
export type TableChoice =
  | { action: 'reuse' }
  | { action: 'share' }
  | { action: 'rename-existing'; to: string };

export interface PlanContext {
  /** The app's own prefix (`pos_`), or null for an app whose tables are not prefixed. */
  prefix: string | null;
  /** A different prefix for every table of this app, chosen on the check step. */
  altPrefix?: string | undefined;
  /** This app's own records on this connection, by short name. */
  records: Readonly<Record<string, { table: string; owned: boolean; state: string }>>;
  /** What OTHER apps record on this connection. */
  others: readonly { appKey: string; table: string; shape: string | null; state: string }[];
  /** The operator's answers, by short name. */
  choices?: Readonly<Record<string, TableChoice>> | undefined;
  dialect: 'postgres' | 'mysql' | 'sqlite';
}

export type TableClass = 'new' | 'own-leftover' | 'shared' | 'taken';
export type ContextTableAction = 'create' | 'reuse' | 'share' | 'rename-existing' | 'undecided';
export type TableOffer = 'reuse' | 'share' | 'rename-existing' | 'alt-prefix';

/** One change a reused table needs, every one of them unable to lose data. */
export type PlanEdit =
  | { kind: 'add-column'; column: string }
  | { kind: 'widen'; column: string; from: string; to: string }
  | { kind: 'set-identity'; column: string }
  | { kind: 'enum-values'; column: string; values: string[] };

export interface InstallTablePlan {
  /** The manifest's short name. */
  ref: string;
  /** The real table: prefixed, recorded, or the ref itself. */
  table: string;
  class: TableClass;
  action: ContextTableAction;
  /** What the check step offers for this table. */
  offers: TableOffer[];
  /** Why reuse is NOT offered on a taken table, for a person. */
  reuseRefusal?: string | undefined;
  /** For `rename-existing`: what the existing table is renamed to. */
  renameExistingTo?: string | undefined;
  /** For `share`: the app whose table this is. */
  sharedWith?: string | undefined;
  /**
   * For `own-leftover`: the earlier install used a table that was already
   * there rather than making it. The check step words the two apart.
   */
  adopted?: true | undefined;
  edits: PlanEdit[];
  /** Columns that cannot be added this way, and why. */
  blocked: { column: string; reason: 'foreign-key' | 'primary-key' | 'unsupported-type' }[];
}
