// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's own settings — the `settings[]` its manifest declares (a business
 * type, a currency, a sentence for a receipt) — checked on the way in and
 * completed with their defaults on the way out.
 *
 * Stored in the same table as add-on settings, keyed by the app key: the two
 * are the same kind of thing, a manifest's declared values, read back in clear.
 * A setting the manifest marks `secret` is refused there, by the repo.
 */
import type { Manifest } from '@adminium/manifest';

type DeclaredSetting = NonNullable<Manifest['settings']>[number];

/** Why each value that does not fit its declaration does not fit. Empty when all do. */
export function settingValueIssues(
  declared: readonly DeclaredSetting[],
  changes: Readonly<Record<string, unknown>>,
): { key: string; message: string }[] {
  const byKey = new Map(declared.map((setting) => [setting.key, setting]));
  const issues: { key: string; message: string }[] = [];
  for (const [key, value] of Object.entries(changes)) {
    const setting = byKey.get(key);
    // Undeclared keys are dropped by the store, not refused (see the repo).
    if (setting === undefined) continue;
    // Null clears a value back to its default.
    if (value === null) continue;
    switch (setting.type) {
      case 'string':
      case 'file':
        if (typeof value !== 'string') issues.push({ key, message: `"${key}" must be text.` });
        break;
      case 'boolean':
        if (typeof value !== 'boolean') issues.push({ key, message: `"${key}" must be true or false.` });
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          issues.push({ key, message: `"${key}" must be a number.` });
        } else if (setting.min !== undefined && value < setting.min) {
          issues.push({ key, message: `"${key}" must be at least ${String(setting.min)}.` });
        } else if (setting.max !== undefined && value > setting.max) {
          issues.push({ key, message: `"${key}" must be at most ${String(setting.max)}.` });
        }
        break;
      case 'enum':
        if (typeof value !== 'string' || !setting.enum.includes(value)) {
          issues.push({ key, message: `"${key}" must be one of ${setting.enum.join(', ')}.` });
        }
        break;
      case 'json':
        break;
    }
  }
  return issues;
}

/**
 * Every declared, non-secret setting with its value: the stored one, else the
 * manifest's default, else null. What the settings page shows and what the
 * app reads from its `surface-config.json`.
 */
export function settingValuesWithDefaults(
  declared: readonly DeclaredSetting[],
  stored: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const setting of declared) {
    if (setting.secret === true) continue;
    const value = stored[setting.key];
    out[setting.key] =
      value !== undefined && value !== null ? value : 'default' in setting && setting.default !== undefined ? setting.default : null;
  }
  return out;
}
