// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The export's secret policy (M10-T03; BRIEF §3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE: **a plaintext secret must never reach the bundle.** Adminium keeps
 * source DSNs and provider keys AES-256-GCM-encrypted at rest (`enc:v1:` tokens,
 * `config/secrets.ts`), so the only two defensible outcomes for a secret-bearing
 * field are: OMIT it, or carry the *still-encrypted* token and say loudly that
 * `ADMINIUM_SECRET` is required to re-open it. This module is the single place
 * that decides which, and it fails closed.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY AN ALLOW-LIST AND NOT A DENY-LIST. A deny-list rots: the next migration
 * adds a column, nobody remembers this file, and the column ships in every
 * export from then on. {@link EXPORTED_COLUMNS} names — per table — the exact
 * columns that may leave the instance. A new column is invisible to the export
 * until someone adds it here, which is the failure direction we want.
 *
 * Notable exclusions and the reason each is not an oversight:
 * - `adminium_connections.introspect_dsn_encrypted` / `data_dsn_encrypted` —
 *   the DSNs. Ciphertext only, and only under `includeSecrets`.
 * - `adminium_connections.last_error` — driver errors routinely quote the whole
 *   connection string ("password authentication failed for user … host=…").
 *   It is a *plaintext* DSN leak wearing a diagnostics costume. Never exported.
 * - `adminium_connections.ssl.caFileId` — a live file reference the target
 *   instance has no file for; nulled rather than left dangling.
 * - `adminium_settings` secret keys (`llm.apiKey`, `email.smtp` — sourced from
 *   the registry's own `secret` flag, never a local copy of the list).
 * - `adminium_settings` non-`portable` keys — the instance's own identity
 *   (`system.instanceId`, `system.bootstrappedAt`) and, above all, the
 *   `system.superAdminCreatedAt` bootstrap CLAIM. Also sourced from the
 *   registry, for the same reason and by the same mechanism as `secret`.
 * - every `*_hash` column, `totp_secret_encrypted`, `secret_encrypted`,
 *   `license_key_encrypted` — they live in tables the export does not carry at
 *   all (users/sessions/api-keys/webhooks/manifests are instance data, not
 *   config), and {@link assertNoCredentialColumns} keeps it that way.
 */

import { SETTING_KEYS, isPortableSettingKey, isSecretSettingKey, isSettingKey } from '@adminium/meta';

import { ENC_TOKEN_PREFIX, isEncryptedSecret } from '../config/secrets.js';

/** Thrown when a value that must be ciphertext is not — the export aborts. */
export class PlaintextSecretError extends Error {
  override readonly name = 'PlaintextSecretError';
  constructor(where: string) {
    super(
      `refusing to export ${where}: the value is not an "${ENC_TOKEN_PREFIX}" token. ` +
        'A secret is only ever bundled still-encrypted; this one would have gone out in plaintext. ' +
        'This is a bug in the write path that stored it — report it rather than working around it.',
    );
  }
}

/**
 * Settings keys the export always drops, whatever `includeSecrets` says: they
 * identify the *source instance* or record that its bootstrap already happened,
 * neither of which is configuration.
 *
 * DERIVED from the registry's `portable` flag, not maintained here. It used to
 * be a hand-written list of two — and it rotted inside the same wave that wrote
 * it: `system.superAdminCreatedAt`, the once-only first-boot claim, was added to
 * the registry and nobody remembered this file, so every full-instance bundle
 * carried the claim. Importing one into a fresh install left it with zero users
 * and `/setup/*` closed forever: unusable, unrecoverable, silent. Exactly the
 * rot this module's header predicts of deny-lists. The registry is now the
 * authority — a new key is non-portable until declared otherwise — and this
 * constant is kept only because the manifest and the tests name it.
 */
export const INSTANCE_IDENTITY_SETTINGS: readonly string[] = SETTING_KEYS.filter(
  (key) => !isPortableSettingKey(key),
);

/**
 * The per-table column allow-list. Keys are the tables the bundle carries;
 * every other `adminium_*` table is instance data (users, sessions, api keys,
 * audit, jobs, notifications, llm runs, files, …) and is not config.
 *
 * Columns listed here are the ONLY ones serialized. Secret-bearing columns are
 * absent on purpose and are added back — as ciphertext — by
 * {@link secretColumnsFor} when `includeSecrets` is on.
 */
export const EXPORTED_COLUMNS = {
  adminium_settings: ['key', 'value'],
  adminium_roles: ['id', 'slug', 'name', 'description', 'isBuiltin'],
  adminium_role_permissions: ['id', 'roleId', 'resourceKind', 'resourceRef', 'actions'],
  adminium_connections: ['id', 'name', 'engine', 'sourceKind', 'readOnly', 'ssl', 'settings'],
  adminium_schema_snapshots: [
    'id',
    'connectionId',
    'source',
    'importFormat',
    'engineVersion',
    'schema',
    'stats',
    'checksum',
    'isActive',
  ],
  adminium_schema_overrides: [
    'id',
    'connectionId',
    'op',
    'tableName',
    'columnName',
    'value',
    'origin',
    'status',
    'confidence',
  ],
  adminium_pages: [
    'id',
    'connectionId',
    'slug',
    'type',
    'title',
    'icon',
    'navGroup',
    'navOrder',
    'config',
    'origin',
    'generatedFromSnapshotId',
    'isEnabled',
  ],
  adminium_views: ['id', 'pageId', 'kind', 'name', 'config', 'isDefault'],
} as const satisfies Record<string, readonly string[]>;

export type ExportedTable = keyof typeof EXPORTED_COLUMNS;

/** Ciphertext columns re-admitted only under `--include-secrets`. */
export function secretColumnsFor(table: ExportedTable): readonly string[] {
  return table === 'adminium_connections'
    ? ['introspectDsnEncrypted', 'dataDsnEncrypted']
    : [];
}

/**
 * Column-name shapes that must never appear in a bundle. This is the
 * belt-and-braces companion to the allow-list: the allow-list decides what gets
 * in, this asserts nothing credential-shaped slipped through a typo or a future
 * edit. Checked in a unit test against {@link EXPORTED_COLUMNS} itself, so the
 * violation is caught at CI time and not at export time.
 */
const CREDENTIAL_COLUMN_PATTERNS: readonly RegExp[] = [
  /hash$/i,
  /token/i,
  /password/i,
  /secret/i,
  /^recoveryCodes$/i,
  /apiKey/i,
  /lastError/i,
];

/** Throws if any allow-listed column looks credential-bearing. */
export function assertNoCredentialColumns(): void {
  for (const [table, columns] of Object.entries(EXPORTED_COLUMNS)) {
    for (const column of columns) {
      const bad = CREDENTIAL_COLUMN_PATTERNS.find((re) => re.test(column));
      if (bad !== undefined) {
        throw new PlaintextSecretError(`${table}.${column} (matches ${String(bad)})`);
      }
    }
  }
}

/**
 * Project a row down to its allow-listed columns. Anything not named is
 * dropped — including columns added by a future migration.
 */
export function pickColumns(
  row: Record<string, unknown>,
  columns: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of columns) {
    if (row[column] !== undefined) out[column] = row[column];
  }
  return out;
}

/**
 * Verify a value destined for the bundle is an `enc:v1:` token, and return it.
 * `null` passes through (an unset secret is not a secret).
 */
export function assertCiphertext(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !isEncryptedSecret(value)) {
    throw new PlaintextSecretError(where);
  }
  return value;
}

export interface SettingsRedactionResult {
  /** Rows safe to bundle. */
  rows: { key: string; value: unknown }[];
  /** Secret keys dropped because `includeSecrets` was off. */
  droppedSecretKeys: string[];
  /** Secret keys carried as ciphertext (require ADMINIUM_SECRET to re-open). */
  encryptedKeys: string[];
}

/**
 * Apply the settings policy. BOTH flags — `secret` and `portable` — come from
 * the `@adminium/meta` settings registry: the registry is the authority on what
 * is sensitive and on what is configuration at all, so a new key is handled
 * correctly the day it is declared, with no edit here. That is the "one code
 * path" rule applied to redaction, and it fails closed in both directions (a new
 * key is neither exported nor assumed harmless).
 */
export function redactSettings(
  rows: readonly { key: string; value: unknown }[],
  includeSecrets: boolean,
): SettingsRedactionResult {
  const out: SettingsRedactionResult = { rows: [], droppedSecretKeys: [], encryptedKeys: [] };

  for (const row of rows) {
    // Unknown/stale keys are not config this build understands — drop them
    // rather than round-trip something we cannot validate.
    if (!isSettingKey(row.key)) continue;
    // Not configuration: instance identity, or the bootstrap claim.
    if (!isPortableSettingKey(row.key)) continue;

    if (!isSecretSettingKey(row.key)) {
      out.rows.push({ key: row.key, value: row.value });
      continue;
    }

    if (!includeSecrets) {
      out.droppedSecretKeys.push(row.key);
      continue;
    }

    // Secret key, secrets requested: it may only travel as ciphertext.
    assertSecretSettingIsEncrypted(row.key, row.value);
    out.rows.push({ key: row.key, value: row.value });
    out.encryptedKeys.push(row.key);
  }

  return out;
}

/**
 * A secret setting is either a bare `enc:v1:` token (`llm.apiKey`) or an object
 * with encrypted leaves (`email.smtp.passEncrypted`). Both are checked; a
 * `null` value is an unset key and is fine.
 */
function assertSecretSettingIsEncrypted(key: string, value: unknown): void {
  if (value === null || value === undefined) return;

  if (typeof value === 'string') {
    assertCiphertext(value, `settings.${key}`);
    return;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const [field, leaf] of Object.entries(value as Record<string, unknown>)) {
      // Only the *Encrypted fields are secrets; host/port/user/from are config.
      if (field.endsWith('Encrypted')) assertCiphertext(leaf, `settings.${key}.${field}`);
    }
    return;
  }

  throw new PlaintextSecretError(`settings.${key} (unexpected value shape)`);
}

/** True when the registry declares `key` secret. Re-exported for the manifest. */
export function isSecretKey(key: string): boolean {
  return isSettingKey(key) && isSecretSettingKey(key);
}
