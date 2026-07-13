/**
 * The `DatabaseAdapter` contract — 05-introspection-engine.md §3, with the
 * three-connection privilege model of 01-architecture.md §3.
 *
 * `@adminium/engine` defines this interface but never imports adapter
 * packages; `@adminium/server` composes concrete adapters at boot through
 * the registry (01-architecture.md §2.3.1, ./adapter-registry.ts). Adapter
 * packages (`@adminium/adapter-postgres`, …) import ONLY
 * `@adminium/engine/adapter` — this module — which re-exports the
 * SchemaModel types they need.
 *
 * THE "SCHEMA ONLY" INVARIANT (05 §10): `introspect()` reads catalog
 * metadata exclusively — never user rows. Row-touching methods (`sample`,
 * `sampleColumn`, `query`, `mutate`, `count`) exist only on the post-setup
 * `data`-role instance and are compile-time blocked on the `introspect`
 * instance via `this` typing on the role-branded interface below (plus a
 * runtime guard every implementation must add — tested by the shared
 * adapter test kit, 05-T02).
 */
import { AdapterRegistry } from './adapter-registry.js';
import type { AdapterError } from './adapter-registry.js';
import type { AdapterCapabilities, DatabaseModel, Dialect, LogicalType } from './schema-model.js';

// ---------------------------------------------------------------------------
// Connection configs (role-branded)
// ---------------------------------------------------------------------------

/**
 * The three logical connections per source (01-architecture.md §3):
 * `introspect` (schema metadata only), `data` (CRUD on included tables),
 * `meta` (adminium_* tables; owned by @adminium/meta and never handed to
 * adapters in v1 — listed for completeness of the brand).
 */
export type ConnectionRole = 'introspect' | 'data' | 'meta';

/**
 * Role-branded connection config. The brand is what makes `introspect()`
 * uncallable on a data-role instance (and vice versa) at compile time.
 */
export interface ConnectionConfig<Role extends ConnectionRole = ConnectionRole> {
  readonly role: Role;
  /**
   * DSN for network dialects (`postgres://…`, `mysql://…`). SQLite accepts
   * `sqlite:///abs/path.db`, `file:abs/path.db`, or a plain path via `file`.
   */
  readonly dsn?: string;
  /** SQLite: absolute database file path (or ':memory:' for demo/test). */
  readonly file?: string;
  /** SQLite open mode; introspect instances always open readonly. */
  readonly mode?: 'readonly' | 'readwrite';
  /** Pool size hint (pg introspect role defaults to 5 — 05 §4.1). */
  readonly poolMax?: number;
  /** Per-statement timeout; defaults per dialect (05 §4). */
  readonly statementTimeoutMs?: number;
}

export type IntrospectConnectionConfig = ConnectionConfig<'introspect'>;
export type DataConnectionConfig = ConnectionConfig<'data'>;

// ---------------------------------------------------------------------------
// Probe / test results
// ---------------------------------------------------------------------------

/** Result of `test()` — 05 §3. */
export interface TestResult {
  ok: boolean;
  latencyMs: number;
  serverVersion: string | null;
  currentUser: string | null;
  canWrite: boolean;
  ssl: boolean;
  error?: AdapterError;
}

/** Dialect-specific privilege probes (01-architecture.md §3). */
export interface PrivilegeProbe {
  canReadSchema: boolean;
  canRead: boolean;
  canWrite: boolean;
  canDDL: boolean;
}

/**
 * Result of `probeCapabilities()` — persisted on the connection row and
 * driving UI honesty (a read-only data role renders the app read-only).
 */
export interface CapabilityProbeResult {
  capabilities: AdapterCapabilities;
  privileges: PrivilegeProbe;
  serverVersion: string;
  /** Current role/user with read-only detection for the connected role. */
  currentRole: { name: string; readOnly: boolean };
}

// ---------------------------------------------------------------------------
// Introspection (schema only — never rows)
// ---------------------------------------------------------------------------

export interface IntrospectOptions {
  /** Default: all non-system (pg) / the connected db (mysql) / 'main' (sqlite). */
  schemas?: string[];
  /** Optional include-predicate applied after enumeration (e.g. > 2,000-table guard). */
  tableFilter?: (table: { schema: string; name: string }) => boolean;
  /** Default true — ESTIMATES only, never COUNT during setup (05 §10). */
  collectRowEstimates?: boolean;
  /** Default true where supported. */
  collectActivityStats?: boolean;
  /** Default 30_000 total, 15_000 per statement. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Data-role query surface (post-setup only)
// ---------------------------------------------------------------------------

export interface TableRef {
  /** null for dialects without schemas (mysql/sqlite). */
  schema: string | null;
  name: string;
}

/** Filter ops are whitelisted per LogicalType by the engine before compile. */
export type FilterOp =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'not-in'
  | 'like'
  | 'ilike'
  | 'contains'
  | 'starts-with'
  | 'ends-with'
  | 'between'
  | 'is-null'
  | 'is-not-null';

/** AND/OR tree of column predicates (05 §3). Values always bind as parameters. */
export type FilterSpec =
  | { and: FilterSpec[] }
  | { or: FilterSpec[] }
  | { not: FilterSpec }
  | { column: string; op: FilterOp; value?: unknown };

/** Declarative SELECT/aggregate for widgets & grids — compiled through Kysely. */
export interface QuerySpec {
  table: TableRef;
  /** Default: non-secret columns. */
  select?: string[];
  aggregates?: { fn: 'count' | 'sum' | 'avg' | 'min' | 'max'; column?: string; as: string }[];
  groupBy?: (string | { bucket: 'day' | 'week' | 'month'; column: string })[];
  filter?: FilterSpec;
  orderBy?: { column: string; dir: 'asc' | 'desc' }[];
  /** Hard-capped at 1_000 by the engine. */
  limit?: number;
  offset?: number;
}

export type Row = Record<string, unknown>;

export interface QueryResult {
  rows: Row[];
  /** Column meta for serialization quirks (e.g. mysql unsigned bigint → string). */
  columns: { name: string; logicalType: LogicalType }[];
  warnings?: string[];
}

export type MutationSpec =
  | { kind: 'insert'; table: TableRef; values: Row | Row[] }
  | { kind: 'update'; table: TableRef; filter: FilterSpec; values: Row }
  | { kind: 'delete'; table: TableRef; filter: FilterSpec };

export interface MutationResult {
  affected: number;
  /** Mutated rows where the dialect supports RETURNING; null otherwise. */
  returning: Row[] | null;
}

/** Sampling caps enforced by every implementation (05 §10). */
export interface SampleOptions {
  /** Default: non-secret, PII-masked columns. */
  columns?: string[];
  /** LIMIT ≤ 100; values truncated at 256 chars. */
  limit?: number;
  /** Recorded in adminium_audit_log. */
  purpose: 'preview' | 'classify' | 'llm';
}

/**
 * Options for the optional single-column sampler. `optIn: true` is a
 * deliberate speed bump: row values leave the database ONLY when the caller
 * explicitly acknowledges it (the user-facing "schema only, never your rows"
 * promise applies to setup — this method must never run during setup and is
 * always audit-logged).
 */
export interface ColumnSampleOptions {
  /** Must be literally `true` — there is no implicit sampling. */
  optIn: true;
  /** LIMIT ≤ 100; values truncated at 256 chars. */
  limit?: number;
  purpose: 'preview' | 'classify' | 'llm';
}

// ---------------------------------------------------------------------------
// QueryPort — how the CRUD layer gets a query engine (05 §3, 08 §3.7)
// ---------------------------------------------------------------------------

/** Per-LogicalType value converters between JS and the wire format. */
export interface TypeSerializer {
  /** JS value → driver parameter (e.g. bigint → string for mysql). */
  toDb(value: unknown): unknown;
  /** Driver value → serializable JS (int8/decimal → string, timestamps → ISO-8601 UTC). */
  fromDb(value: unknown): unknown;
}

/**
 * What `createQueryEngine()` hands the CRUD layer (08-server-api.md §3.7):
 * everything dynamic Kysely needs for the data connection. The engine
 * package does not depend on `kysely`, so the dialect is typed opaquely —
 * `@adminium/server` (which owns the Kysely dependency) casts it to
 * `kysely.Dialect` at the composition boundary.
 */
export interface QueryEngine {
  /** A Kysely `Dialect` instance for the pooled data connection. */
  dialect: unknown;
  /** Identifier quoting rules — identifiers are still snapshot-validated first. */
  identifiers: { quote(identifier: string): string; maxLength: number };
  serializers: Partial<Record<LogicalType, TypeSerializer>>;
  /** Tear down the underlying pool. */
  destroy(): Promise<void>;
}

/** Workplan alias — 08-server-api.md calls this the CRUD "query port". */
export type QueryPort = QueryEngine;

// ---------------------------------------------------------------------------
// The adapter itself
// ---------------------------------------------------------------------------

/**
 * One instance per logical connection (role). Methods carry `this` types so
 * that `introspect()` type-checks only on an `'introspect'`-role instance
 * and row-touching methods only on a `'data'`-role instance. Every method
 * rejects with {@link AdapterError} on failure.
 *
 * No raw SQL escape hatch: identifiers are validated against the current
 * schema snapshot before compilation (unknown table/column → typed
 * `SCHEMA_DRIFT`), values are always parameterized.
 */
export interface DatabaseAdapter<Role extends ConnectionRole = ConnectionRole> {
  readonly dialect: Dialect;
  /** Static, dialect-level capabilities (probe refines per-connection). */
  readonly capabilities: AdapterCapabilities;
  readonly role: Role;

  /** Lazy pool; throws AdapterError with a typed code. */
  connect(config: ConnectionConfig<Role>): Promise<void>;
  test(): Promise<TestResult>;
  /** Runs on every connect/test; results persist on the connection row. */
  probeCapabilities(): Promise<CapabilityProbeResult>;

  /** SCHEMA ONLY — reads catalog/pragma namespaces exclusively (05 §10). */
  introspect(this: DatabaseAdapter<'introspect'>, opts?: IntrospectOptions): Promise<DatabaseModel>;

  /** Capped count: `cap` (default 100_001) renders as "100,000+". */
  count(
    this: DatabaseAdapter<'data'>,
    table: TableRef,
    filter?: FilterSpec,
    opts?: { cap?: number },
  ): Promise<{ value: number; capped: boolean }>;
  /** Post-setup only; caps per 05 §10 (LIMIT ≤ 100, truncation, secret exclusion, PII masking). */
  sample(this: DatabaseAdapter<'data'>, table: TableRef, opts: SampleOptions): Promise<Row[]>;
  /** Optional single-column sampler; see {@link ColumnSampleOptions}. */
  sampleColumn?(
    this: DatabaseAdapter<'data'>,
    table: TableRef,
    column: string,
    opts: ColumnSampleOptions,
  ): Promise<unknown[]>;
  query(this: DatabaseAdapter<'data'>, spec: QuerySpec): Promise<QueryResult>;
  /** insert/update/delete, returning rows where supported. */
  mutate(this: DatabaseAdapter<'data'>, spec: MutationSpec): Promise<MutationResult>;

  /** Release pools/handles; idempotent. */
  close(): Promise<void>;
}

export type IntrospectAdapter = DatabaseAdapter<'introspect'>;
export type DataAdapter = DatabaseAdapter<'data'>;

/**
 * What an adapter package exports and the server registers at boot
 * (01-architecture.md §2.3.1): a factory keyed by dialect, plus the
 * QueryPort factory the CRUD layer uses to obtain a Kysely dialect for the
 * data connection without holding a full adapter instance.
 */
export interface AdapterProvider {
  readonly dialect: Dialect;
  /** Build an adapter instance for one role-branded connection. */
  create<Role extends ConnectionRole>(
    config: ConnectionConfig<Role>,
  ): DatabaseAdapter<Role> | Promise<DatabaseAdapter<Role>>;
  /** Build the CRUD query port for a data-role connection (08 §3.7). */
  createQueryEngine(config: DataConnectionConfig): QueryEngine | Promise<QueryEngine>;
}

// ---------------------------------------------------------------------------
// Registry binding (01-architecture.md §2.3.1)
// ---------------------------------------------------------------------------

/** The process-wide registry the server boot sequence populates. */
export const adapterRegistry = new AdapterRegistry<AdapterProvider>();

/** Convenience wrapper over {@link adapterRegistry}.register. */
export function registerAdapter(provider: AdapterProvider): void;
export function registerAdapter(dialect: Dialect, factory: Omit<AdapterProvider, 'dialect'>): void;
export function registerAdapter(
  providerOrDialect: AdapterProvider | Dialect,
  factory?: Omit<AdapterProvider, 'dialect'>,
): void {
  if (typeof providerOrDialect === 'string') {
    if (factory === undefined) {
      throw new Error('registerAdapter(dialect, factory) requires a factory');
    }
    adapterRegistry.register({ dialect: providerOrDialect, ...factory });
    return;
  }
  adapterRegistry.register(providerOrDialect);
}

/** Convenience wrapper over {@link adapterRegistry}.get. */
export function getAdapter(dialect: Dialect): AdapterProvider {
  return adapterRegistry.get(dialect);
}

// The './adapter' subpath is the single entry point adapter packages may
// import (dep-cruiser matrix, 01-architecture.md §2.3) — re-export the
// SchemaModel types and the registry mechanics here.
export * from './schema-model.js';
export * from './adapter-registry.js';
