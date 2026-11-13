// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an archive may carry and what a restore may write: ONE function,
 * {@link sanitizeDump}, run by the writer on the way out AND by the restore on
 * the way in. The restore does not trust the writer: a file that claims to be
 * an export is held to the export rules, and rows no archive should hold
 * (sessions, add-on trust) are dropped whatever the file says.
 *
 * Never in any archive, and never written by a restore:
 * - sessions, password-reset and invitation tokens, public visitors' sessions,
 *   one-time codes and proofs, and what the server's operator holds back
 *   ({@link NEVER_ARCHIVED_TABLES}), and the events queued for that operator
 *   ({@link NEVER_ARCHIVED_JOB_KINDS});
 * - `addOns.deciderTrust` (which add-on code may decide), the Designer's live
 *   switch and live id, and "Allow databases on this server"
 *   (`connections.allowLocalDatabases`: whether this server's own loopback is
 *   reachable is decided on that server, by its super admin), and which
 *   release the built-in email templates were last seeded from
 *   (`email.builtinsSeededFor`: the server that restores seeds them again)
 *   ({@link NEVER_ARCHIVED_SETTINGS});
 * - copies of catalog packages: their file rows are dropped and each install's
 *   `packageFileId`/`packageIntegrity` cleared, so a restored instance shows
 *   them as Missing and fetches and verifies them again from the catalog;
 * - a workspace install that was not finished (its staged files are gone).
 *
 * API keys travel in a full archive and are dropped on restore unless asked
 * (`--keep-api-keys`). An export carries none.
 */

import { isSecretSettingKey, isSettingKey } from '@adminium/meta';
import type { MetaTableDump } from '@adminium/meta';

import { SECRET_SOURCES } from '../apps/save/gates/secrets.js';
import { ENC_TOKEN_PREFIX } from '../config/secrets.js';

export const NEVER_ARCHIVED_TABLES: readonly string[] = [
  // The ledger: a restore builds its own by running the migrations.
  'adminium_migrations',
  'adminium_sessions',
  'adminium_password_resets',
  'adminium_public_sessions',
  'adminium_public_challenges',
  'adminium_public_proofs',
  // What the server's operator holds back (public pages hidden) is that server's operator's word, never a file's.
  'adminium_operator_holds',
  // What the server counts for its operator (the AI budget's spend, the start prompt's run): never set back by a file.
  'adminium_operator_tallies',
];

/** Staff API keys and the public API's keys. */
export const API_KEY_TABLES: readonly string[] = ['adminium_api_keys', 'adminium_public_keys'];

/** Queue state, not anyone's work; an export leaves it out. A full archive keeps it (the same instance coming back). */
const EXPORT_SKIPPED_TABLES: readonly string[] = ['adminium_jobs'];

/**
 * Queued jobs no archive carries, even a full one: the events this instance
 * owes its server's operator (`operator/events.ts`). Another server, or this
 * one restored elsewhere, must not send them, signed with its own token.
 */
export const NEVER_ARCHIVED_JOB_KINDS: readonly string[] = ['operator.event'];

export const NEVER_ARCHIVED_SETTINGS: readonly string[] = ['addOns.deciderTrust', 'designer.live', 'designer.liveId', 'connections.allowLocalDatabases', 'email.builtinsSeededFor'];

/**
 * This instance's own identity: an export does not clone it onto another server. Nor does it say who a
 * desktop app signs in WITHOUT a password (`designer.ownerId`, `designer.localOwnerId`): the file is
 * untrusted, so the computer it is opened on decides that (`import-zip --local-owner`), never the file.
 */
const EXPORT_SKIPPED_SETTINGS: readonly string[] = ['system.instanceId', 'system.bootstrappedAt', 'designer.ownerId', 'designer.localOwnerId'];

/**
 * Consent records keep their rows when secrets are dropped: their values no
 * longer open, but deleting who unsubscribed is worse than keeping a row that
 * cannot be read. Only a full restore with `--drop-secrets` reaches this; an
 * export leaves the sealed values out entirely.
 */
const KEEP_SEALED_ROWS: readonly string[] = ['adminium_stop_list', 'adminium_address_keys'];

export interface SanitizeOptions {
  /** `export`: no password hashes, secrets, keys or tokens. */
  kind: 'full' | 'export';
  /** The dump's own dialect: tells a JSON cell (decoded) from JSON text (SQLite). */
  dialect: 'sqlite' | 'postgres' | 'mysql';
  /** Restore only: keep API keys. Ignored for an export. */
  keepApiKeys?: boolean;
  /** Full restore under a different secret: every sealed value is dropped. */
  dropSecrets?: boolean;
}

export interface SanitizeReport {
  droppedTables: string[];
  droppedSettings: string[];
  /** `<table>.<column>` cleared, with how many rows. */
  clearedColumns: Record<string, number>;
  /** Rows dropped because a sealed NOT NULL value could not travel. */
  droppedRows: Record<string, number>;
  /** Sealed values kept unreadable (consent records). */
  unreadableRows: Record<string, number>;
}

/** Row-shaped view over a table dump, written back with {@link commitRows}. */
export function rowsOf(dump: MetaTableDump): Record<string, unknown>[] {
  return dump.rows.map((cells) => Object.fromEntries(dump.columns.map((column, index) => [column, cells[index]])));
}

export function commitRows(dump: MetaTableDump, rows: readonly Record<string, unknown>[]): void {
  dump.rows = rows.map((row) => dump.columns.map((column) => row[column] ?? null));
}

/** A JSON cell's value, whatever the dialect stored. */
export function readJsonCell(dump: MetaTableDump, column: string, value: unknown): unknown {
  if (dump.kinds[column] === 'json' || typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** The inverse: what the dump stores for a JSON value in this column. */
export function writeJsonCell(dump: MetaTableDump, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return dump.kinds[column] === 'json' ? value : JSON.stringify(value);
}

function parseJsonText(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

const isSealed = (value: unknown): boolean => typeof value === 'string' && value.startsWith(ENC_TOKEN_PREFIX);

/** Replace every sealed string inside a JSON value with null. Returns how many it cleared. */
function scrubJson(value: unknown): { value: unknown; cleared: number } {
  if (isSealed(value)) return { value: null, cleared: 1 };
  if (Array.isArray(value)) {
    let cleared = 0;
    const out = value.map((item) => {
      const next = scrubJson(item);
      cleared += next.cleared;
      return next.value;
    });
    return { value: out, cleared };
  }
  if (value !== null && typeof value === 'object') {
    let cleared = 0;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const next = scrubJson(item);
      cleared += next.cleared;
      out[key] = next.value;
    }
    return { value: out, cleared };
  }
  return { value, cleared: 0 };
}

/** `SECRET_SOURCES`, as table → columns holding a sealed value (the `#key` ones are found by the JSON scrub). */
function sealedColumns(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const source of SECRET_SOURCES) {
    if (source.includes('#')) continue;
    const [table, column] = source.split('.') as [string, string];
    out.set(table, [...(out.get(table) ?? []), column]);
  }
  return out;
}

/** Columns a NOT NULL constraint keeps from being cleared: their row goes instead. */
const NOT_NULL_SEALED: ReadonlySet<string> = new Set([
  'adminium_add_on_credentials.payload',
  'adminium_public_keys.tokenEncrypted',
  'adminium_address_keys.keyEncrypted',
  'adminium_email_notice_endpoints.tokenEncrypted',
  'adminium_email_notice_endpoints.secretEncrypted',
  'adminium_email_dkim_keys.privateKeyEncrypted',
  'adminium_payment_links.tokenSealed',
]);

function bump(record: Record<string, number>, key: string, by = 1): void {
  record[key] = (record[key] ?? 0) + by;
}

/** Drop every sealed value: the export, and a full restore under another secret. */
function dropSealed(tables: Map<string, MetaTableDump>, report: SanitizeReport, keepConsent: boolean): void {
  const listed = sealedColumns();
  for (const dump of tables.values()) {
    const named = listed.get(dump.table) ?? [];
    const rows = rowsOf(dump);
    const kept: Record<string, unknown>[] = [];
    for (const row of rows) {
      let drop = false;
      let unreadable = false;
      for (const column of dump.columns) {
        const value = row[column];
        const isNamed = named.includes(column);
        if (isNamed || isSealed(value)) {
          if (value === null || value === undefined || value === '') continue;
          if (keepConsent && KEEP_SEALED_ROWS.includes(dump.table)) {
            unreadable = true;
            continue;
          }
          if (NOT_NULL_SEALED.has(`${dump.table}.${column}`)) {
            drop = true;
            break;
          }
          row[column] = null;
          bump(report.clearedColumns, `${dump.table}.${column}`);
          continue;
        }
        if (typeof value === 'string' && value.includes(ENC_TOKEN_PREFIX)) {
          // JSON text (a SQLite json column) with a sealed value inside.
          const parsed = parseJsonText(value);
          if (typeof parsed === 'object' && parsed !== null) {
            const scrubbed = scrubJson(parsed);
            if (scrubbed.cleared > 0) {
              row[column] = JSON.stringify(scrubbed.value);
              bump(report.clearedColumns, `${dump.table}.${column}`);
            }
          }
          continue;
        }
        if (value !== null && typeof value === 'object') {
          const scrubbed = scrubJson(value);
          if (scrubbed.cleared > 0) {
            row[column] = scrubbed.value;
            bump(report.clearedColumns, `${dump.table}.${column}`);
          }
        }
      }
      if (drop) bump(report.droppedRows, dump.table);
      else {
        if (unreadable) bump(report.unreadableRows, dump.table);
        kept.push(row);
      }
    }
    commitRows(dump, kept);
  }
}

/**
 * Apply the archive rules to a dump, in place. Returns what it removed, in
 * counts, for the CLI to say.
 */
export function sanitizeDump(tables: Map<string, MetaTableDump>, opts: SanitizeOptions): SanitizeReport {
  const report: SanitizeReport = { droppedTables: [], droppedSettings: [], clearedColumns: {}, droppedRows: {}, unreadableRows: {} };
  const exporting = opts.kind === 'export';

  const skipTables = [
    ...NEVER_ARCHIVED_TABLES,
    ...(exporting || opts.keepApiKeys !== true ? API_KEY_TABLES : []),
    ...(exporting ? EXPORT_SKIPPED_TABLES : []),
  ];
  for (const table of skipTables) {
    if (tables.delete(table)) report.droppedTables.push(table);
  }

  const jobs = tables.get('adminium_jobs');
  if (jobs !== undefined) {
    const rows = rowsOf(jobs);
    const kept = rows.filter((row) => !NEVER_ARCHIVED_JOB_KINDS.includes(String(row.kind)));
    if (kept.length !== rows.length) report.droppedRows.adminium_jobs = rows.length - kept.length;
    commitRows(jobs, kept);
  }

  const settings = tables.get('adminium_settings');
  if (settings !== undefined) {
    const kept = rowsOf(settings).filter((row) => {
      const key = String(row.key);
      const drop =
        NEVER_ARCHIVED_SETTINGS.includes(key) ||
        (exporting && EXPORT_SKIPPED_SETTINGS.includes(key)) ||
        ((exporting || opts.dropSecrets === true) && isSettingKey(key) && isSecretSettingKey(key));
      if (drop) report.droppedSettings.push(key);
      return !drop;
    });
    commitRows(settings, kept);
  }

  const files = tables.get('adminium_files');
  if (files !== undefined) {
    const rows = rowsOf(files);
    const kept = rows.filter((row) => row.kind !== 'package');
    if (kept.length !== rows.length) report.droppedRows.adminium_files = rows.length - kept.length;
    commitRows(files, kept);
  }

  const manifests = tables.get('adminium_manifests');
  if (manifests !== undefined) {
    const rows = rowsOf(manifests);
    for (const row of rows) {
      if (row.packageFileId !== null || row.packageIntegrity !== null) bump(report.clearedColumns, 'adminium_manifests.packageFileId');
      row.packageFileId = null;
      row.packageIntegrity = null;
    }
    commitRows(manifests, rows);
  }

  const installs = tables.get('adminium_workspace_installs');
  if (installs !== undefined) {
    const rows = rowsOf(installs);
    const kept = rows.filter((row) => row.state === 'done' || row.state === 'discarded');
    if (kept.length !== rows.length) report.droppedRows.adminium_workspace_installs = rows.length - kept.length;
    commitRows(installs, kept);
  }

  if (exporting) {
    const users = tables.get('adminium_users');
    if (users !== undefined) {
      const rows = rowsOf(users);
      for (const row of rows) {
        if (row.passwordHash !== null) bump(report.clearedColumns, 'adminium_users.passwordHash');
        row.passwordHash = null;
        row.recoveryCodes = null;
        // A second factor whose secret did not travel cannot be asked for.
        row.totpEnabled = typeof row.totpEnabled === 'boolean' ? false : 0;
      }
      commitRows(users, rows);
    }
  }

  if (exporting || opts.dropSecrets === true) dropSealed(tables, report, !exporting);
  if (opts.dropSecrets === true && !exporting) {
    // A second factor whose secret no longer opens would lock its person out.
    const users = tables.get('adminium_users');
    if (users !== undefined) {
      const rows = rowsOf(users);
      for (const row of rows) if (row.totpSecretEncrypted === null) row.totpEnabled = typeof row.totpEnabled === 'boolean' ? false : 0;
      commitRows(users, rows);
    }
  }
  return report;
}
