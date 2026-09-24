// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Ordered, append-only migration list. Up-only: a
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
import { up as up0015 } from './0015_connection_tenant_config.js';
import { up as up0014 } from './0014_public_surface.js';
import { up as up0016 } from './0016_audit_entity.js';
import { up as up0017 } from './0017_surface_binding.js';
import { up as up0018 } from './0018_connection_timezone_source.js';
import { up as up0019 } from './0019_connection_disabled.js';
import { up as up0020 } from './0020_manifests_add_on.js';
import { up as up0021 } from './0021_add_on_credentials.js';
import { up as up0023 } from './0023_schema_authoring.js';
import { up as up0022 } from './0022_studio_namespace.js';
import { up as up0024 } from './0024_file_destinations.js';
import { up as up0025 } from './0025_schema_change_acknowledged_rows.js';
import { up as up0026 } from './0026_email_documents.js';
import { up as up0027 } from './0027_invoice_documents.js';
import { up as up0028 } from './0028_automations_runtime.js';
import { up as up0029 } from './0029_dataio_files_email_namespace.js';
import { up as up0031 } from './0031_documents.js';
import { up as up0032 } from './0032_nav_group_width.js';
import { up as up0033 } from './0033_connection_project_key.js';
import { up as up0034 } from './0034_project_files.js';
import { up as up0035 } from './0035_option_lists.js';
import { up as up0036 } from './0036_assistant_sessions.js';
import { up as up0037 } from './0037_manifest_package_integrity.js';
import { up as up0038 } from './0038_public_endpoints.js';
import { up as up0039 } from './0039_app_install_records.js';
import { up as up0040 } from './0040_app_staff_grant.js';
import { up as up0041 } from './0041_session_persistent.js';
import { up as up0042 } from './0042_clinic_platform.js';
import { up as up0030 } from './0030_report_documents.js';

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
  { name: '0014_public_surface', up: up0014 },
  { name: '0015_connection_tenant_config', up: up0015 },
  { name: '0016_audit_entity', up: up0016 },
  { name: '0017_surface_binding', up: up0017 },
  { name: '0018_connection_timezone_source', up: up0018 },
  { name: '0019_connection_disabled', up: up0019 },
  { name: '0020_manifests_add_on', up: up0020 },
  { name: '0021_add_on_credentials', up: up0021 },
  { name: '0022_studio_namespace', up: up0022 },
  { name: '0023_schema_authoring', up: up0023 },
  { name: '0024_file_destinations', up: up0024 },
  { name: '0025_schema_change_acknowledged_rows', up: up0025 },
  { name: '0026_email_documents', up: up0026 },
  { name: '0027_invoice_documents', up: up0027 },
  { name: '0028_automations_runtime', up: up0028 },
  { name: '0029_dataio_files_email_namespace', up: up0029 },
  { name: '0030_report_documents', up: up0030 },
  { name: '0031_documents', up: up0031 },
  { name: '0032_nav_group_width', up: up0032 },
  { name: '0033_connection_project_key', up: up0033 },
  { name: '0034_project_files', up: up0034 },
  { name: '0035_option_lists', up: up0035 },
  { name: '0036_assistant_sessions', up: up0036 },
  { name: '0037_manifest_package_integrity', up: up0037 },
  { name: '0038_public_endpoints', up: up0038 },
  { name: '0039_app_install_records', up: up0039 },
  { name: '0040_app_staff_grant', up: up0040 },
  { name: '0041_session_persistent', up: up0041 },
  { name: '0042_clinic_platform', up: up0042 },
];
