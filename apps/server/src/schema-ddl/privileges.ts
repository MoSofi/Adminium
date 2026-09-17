// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-target privilege preflight.
 *
 * ─── Why the probe on the connection is not the answer ─────────────────────
 *
 * `PrivilegeProbe.canDDL` is one boolean for a whole connection, and on
 * Postgres it is computed from the wrong thing:
 *
 *     has_database_privilege(current_database(), 'CREATE')
 *     — adapter-postgres/src/introspect.ts:68
 *
 * That is the privilege to create a SCHEMA in the database. It says nothing
 * about whether the role may create a table inside `public`, and nothing at
 * all about whether it may ALTER a table somebody else owns. A role can hold
 * it and be unable to touch a single table; a role can lack it and own every
 * table in the schema.
 *
 * It is also the wrong SHAPE. Privileges in Postgres and MySQL are per object.
 * A role that owns `orders` and not `customers` gets one answer for a plan
 * touching both, and "yes" and "no" are each wrong for half of it. So this
 * module asks per target, at plan time, and the plan carries a refusal naming
 * the table the operator cannot change — which is a thing they can act on,
 * unlike a permission denied error arriving mid-apply after three steps ran.
 *
 * The persisted `can_ddl` column (wave 0023) stays what its comment says it is:
 * a hint for hiding the Studio surface without a round trip. This is the guard.
 *
 * ─── One query per dialect, not one per table ──────────────────────────────
 *
 * All targets are checked in a single statement. A plan touching forty tables
 * must not make forty round trips, and on Postgres the catalog answers the
 * whole set as cheaply as one row.
 */
import { sql, type Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

type Db = Kysely<Record<string, Record<string, unknown>>>;

/** What a plan wants to do to one table, at the granularity privileges have. */
export type DdlAccess = 'create' | 'alter' | 'drop';

export interface PrivilegeQuestion {
  /** Qualified table id (`public.orders`); for a create, the table to be made. */
  tableId: string;
  access: DdlAccess;
}

export interface PrivilegeVerdict extends PrivilegeQuestion {
  allowed: boolean;
  /** Why not — rendered into the refusal, so it names something actionable. */
  reason: string | null;
}

function split(tableId: string): { schema: string | null; name: string } {
  const dot = tableId.lastIndexOf('.');
  return dot === -1
    ? { schema: null, name: tableId }
    : { schema: tableId.slice(0, dot), name: tableId.slice(dot + 1) };
}

/**
 * Check every target in one round trip.
 *
 * A question this cannot answer resolves to `allowed: true`: the database is
 * the real authority and will refuse the statement itself. Guessing "no" from
 * an unreadable catalog would block a legitimate operator on a permission they
 * actually hold, which is the worse of the two failures — the other one costs
 * a clear error message from the engine at apply time.
 */
export async function checkPrivileges(
  db: Db,
  dialect: Dialect,
  questions: readonly PrivilegeQuestion[],
): Promise<PrivilegeVerdict[]> {
  if (questions.length === 0) return [];
  const unknown = (): PrivilegeVerdict[] =>
    questions.map((q) => ({ ...q, allowed: true, reason: null }));

  switch (dialect) {
    case 'postgres':
      // A catalog query that will not run means we do not know — and the
      // database is the real authority, which will refuse the statement
      // itself with its own message. Failing the whole PLAN because a probe
      // could not read `pg_class` would block an operator on a permission
      // they actually hold; the MySQL branch already reasons this way and
      // the two must not disagree.
      return checkPostgres(db, questions).catch(unknown);
    case 'mysql':
      return checkMysql(db, questions).catch(unknown);
    case 'sqlite':
      // The operator owns the file. SQLite has no grant system at all, so
      // "may this role alter this table" is not a question it can be asked —
      // the file is writable or the connection would not have opened.
      return questions.map((q) => ({ ...q, allowed: true, reason: null }));
    default:
      return questions.map((q) => ({ ...q, allowed: true, reason: null }));
  }
}

/**
 * Postgres: `CREATE` on the SCHEMA authorises making a table in it; altering
 * or dropping an existing one requires OWNERSHIP (`pg_has_role(relowner,
 * 'USAGE')` — which is true for a member of the owning role, not only the
 * owner itself, and is what `ALTER TABLE`'s own check uses).
 */
async function checkPostgres(db: Db, questions: readonly PrivilegeQuestion[]): Promise<PrivilegeVerdict[]> {
  const creates = questions.filter((q) => q.access === 'create');
  const existing = questions.filter((q) => q.access !== 'create');

  const schemaAllowed = new Map<string, boolean>();
  const schemas = [...new Set(creates.map((q) => split(q.tableId).schema ?? 'public'))];
  if (schemas.length > 0) {
    const list = schemas.map((s) => `(${literal(s)})`).join(', ');
    const rows = await sql
      .raw<{ nspname: string; allowed: boolean }>(
        `SELECT s.nspname, pg_catalog.has_schema_privilege(s.nspname, 'CREATE') AS allowed ` +
          `FROM (VALUES ${list}) AS s(nspname)`,
      )
      .execute(db);
    for (const row of rows.rows) schemaAllowed.set(row.nspname, row.allowed === true);
  }

  /** Targets the LIVE database does not have — the snapshot has moved on. */
  const missing = new Set<string>();
  const ownedAllowed = new Map<string, boolean>();
  if (existing.length > 0) {
    const list = existing
      .map((q) => {
        const { schema, name } = split(q.tableId);
        return `(${literal(schema ?? 'public')}, ${literal(name)})`;
      })
      .join(', ');
    const rows = await sql
      .raw<{ id: string; allowed: boolean; found: boolean }>(
        `SELECT t.nspname || '.' || t.relname AS id, ` +
          // `to_regclass` returns NULL for a table this role cannot even see,
          // which reads as "not yours" — the same answer ALTER would give.
          `COALESCE(pg_catalog.pg_has_role(c.relowner, 'USAGE'), false) AS allowed, ` +
          // …but a table that is not there at all is a DIFFERENT fact, and
          // saying "your role does not own it" about a table somebody dropped
          // in psql sends the operator to look at grants. `relowner IS NULL`
          // separates the two.
          `(c.relowner IS NOT NULL) AS found ` +
          `FROM (VALUES ${list}) AS t(nspname, relname) ` +
          `LEFT JOIN pg_catalog.pg_class c ON c.relname = t.relname ` +
          `LEFT JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.nspname ` +
          `AND n.oid = c.relnamespace`,
      )
      .execute(db);
    for (const row of rows.rows) {
      ownedAllowed.set(row.id, row.allowed === true);
      if (row.found !== true) missing.add(row.id);
    }
  }

  return questions.map((q) => {
    if (q.access === 'create') {
      const schema = split(q.tableId).schema ?? 'public';
      const allowed = schemaAllowed.get(schema) ?? true;
      return {
        ...q,
        allowed,
        reason: allowed ? null : `the connected role cannot create tables in the "${schema}" schema`,
      };
    }
    const allowed = ownedAllowed.get(q.tableId) ?? true;
    if (!allowed && missing.has(q.tableId)) {
      return {
        ...q,
        allowed,
        reason: `"${q.tableId}" is no longer in this database — re-read the schema and plan again`,
      };
    }
    return {
      ...q,
      allowed,
      reason: allowed
        ? null
        : `the connected role does not own "${q.tableId}", so it cannot ${q.access} it`,
    };
  });
}

/**
 * MySQL: privileges are per (database, table) and readable from
 * `information_schema.*_privileges`, but a role holding them through a wildcard
 * grant appears only in `schema_privileges`. Both are consulted, and a table
 * the role can neither see nor alter falls through to `false`.
 */
async function checkMysql(db: Db, questions: readonly PrivilegeQuestion[]): Promise<PrivilegeVerdict[]> {
  const need: Readonly<Record<DdlAccess, string>> = {
    create: 'CREATE',
    alter: 'ALTER',
    drop: 'DROP',
  };

  const rows = await sql
    .raw<{ privilege_type: string; table_name: string | null }>(
      `SELECT privilege_type, NULL AS table_name FROM information_schema.schema_privileges ` +
        `WHERE grantee = CONCAT("'", REPLACE(SUBSTRING_INDEX(CURRENT_USER(), '@', 1), "'", "''"), "'@'", ` +
        `SUBSTRING_INDEX(CURRENT_USER(), '@', -1), "'") AND table_schema = DATABASE() ` +
        `UNION ALL ` +
        `SELECT privilege_type, table_name FROM information_schema.table_privileges ` +
        `WHERE grantee = CONCAT("'", REPLACE(SUBSTRING_INDEX(CURRENT_USER(), '@', 1), "'", "''"), "'@'", ` +
        `SUBSTRING_INDEX(CURRENT_USER(), '@', -1), "'") AND table_schema = DATABASE()`,
    )
    .execute(db)
    .catch(() => ({ rows: [] as { privilege_type: string; table_name: string | null }[] }));

  // An unreadable catalog means we do not know; the database is the authority
  // and will refuse the statement itself. See the header.
  if (rows.rows.length === 0) {
    return questions.map((q) => ({ ...q, allowed: true, reason: null }));
  }

  const schemaWide = new Set(
    rows.rows.filter((r) => r.table_name === null).map((r) => r.privilege_type.toUpperCase()),
  );
  const perTable = new Map<string, Set<string>>();
  for (const row of rows.rows) {
    if (row.table_name === null) continue;
    const set = perTable.get(row.table_name) ?? new Set<string>();
    set.add(row.privilege_type.toUpperCase());
    perTable.set(row.table_name, set);
  }

  return questions.map((q) => {
    const wanted = need[q.access];
    const { name } = split(q.tableId);
    const allowed = schemaWide.has(wanted) || (perTable.get(name)?.has(wanted) ?? false);
    return {
      ...q,
      allowed,
      reason: allowed
        ? null
        : `the connected user lacks the ${wanted} privilege on "${name}"`,
    };
  });
}

/** A single-quoted literal for a VALUES list. Identifiers never reach here. */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Map a step kind to the access it needs — the planner's vocabulary, once. */
export function accessForStepKind(kind: string): DdlAccess {
  if (kind === 'create-table') return 'create';
  if (kind === 'drop-table') return 'drop';
  return 'alter';
}
