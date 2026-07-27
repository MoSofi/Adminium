/**
 * Ordered, append-only migration list (07-meta-store.md §4). Up-only: a
 * mistake ships as a new compensating migration; an applied migration is never
 * edited (enforced by the runner's checksum drift detection).
 *
 * MySQL DDL constraint: `CREATE INDEX IF NOT EXISTS` does not exist on MySQL
 * (tables: fine; indexes: parse error), so index creation here carries no
 * `.ifNotExists()` — the ledger's exactly-once guarantee is the idempotency
 * mechanism, and a rerun after a mid-migration crash failing loudly on a
 * duplicate index beats silently diverging. DECISION (2026-07-20,
 * pre-release): stripping those 29 index guards changed 0001–0007's checksums.
 * Acceptable exactly once — no release exists, a MySQL meta store could never
 * have migrated at all (this parse error, first caught by CI's first-ever
 * [mysql] meta leg), and dev stores re-init. The same 2026-07-20 window also
 * converted 0001–0006's 47 column-level REFERENCES clauses — which MySQL
 * parses and silently discards, leaving a MySQL meta store with zero
 * referential integrity — to named table-level `fk_adminium_*` constraints.
 * After v1.0, checksum-changing edits are forbidden; ship compensating
 * migrations instead.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { up as up0001 } from './0001_core_auth.js';
import { up as up0002 } from './0002_rbac.js';
import { up as up0003 } from './0003_connections_schema.js';
import { up as up0004 } from './0004_pages_views.js';
import { up as up0005 } from './0005_ops.js';
import { up as up0006 } from './0006_platform.js';
import { up as up0007 } from './0007_llm_runs.js';
import { up as up0008 } from './0008_llm_overrides.js';
import { up as up0009 } from './0009_views_kind.js';
import { up as up0010 } from './0010_llm_prompt_version_width.js';
import { up as up0011 } from './0011_i18n_runtime.js';
import { up as up0012 } from './0012_locale_width.js';
import { up as up0013 } from './0013_connection_last_error_hint.js';

export interface MetaMigration {
  /** Basename, e.g. `0001_core_auth` — the ledger PK. */
  readonly name: string;
  readonly up: (db: Kysely<unknown>, c: ColumnHelpers) => Promise<void>;
}

export const ALL_MIGRATIONS: readonly MetaMigration[] = [
  { name: '0001_core_auth', up: up0001 },
  { name: '0002_rbac', up: up0002 },
  { name: '0003_connections_schema', up: up0003 },
  { name: '0004_pages_views', up: up0004 },
  { name: '0005_ops', up: up0005 },
  { name: '0006_platform', up: up0006 },
  { name: '0007_llm_runs', up: up0007 },
  { name: '0008_llm_overrides', up: up0008 },
  { name: '0009_views_kind', up: up0009 },
  { name: '0010_llm_prompt_version_width', up: up0010 },
  { name: '0011_i18n_runtime', up: up0011 },
  { name: '0012_locale_width', up: up0012 },
  { name: '0013_connection_last_error_hint', up: up0013 },
];
