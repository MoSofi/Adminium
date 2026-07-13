/**
 * settingsRepo — adminium_settings (07-meta-store.md §3.2, §7.1).
 * Stores explicit overrides only; reads resolve `stored ?? registry default`.
 */

import type { MetaDb } from '../connect.js';
import {
  SETTINGS_REGISTRY,
  isSettingKey,
  type SettingKey,
  type SettingValue,
} from '../schema/settings-registry.js';
import { MetaValidationError, packJson, readJson } from './util.js';

export class UnknownSettingError extends Error {
  override name = 'UnknownSettingError';
  constructor(key: string) {
    super(`unknown settings key: ${JSON.stringify(key)}`);
  }
}

function assertKey(key: string): asserts key is SettingKey {
  if (!isSettingKey(key)) throw new UnknownSettingError(key);
}

export function settingsRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** Registry default merged with the stored override, validated on the way out. */
    async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
      assertKey(key);
      const def = SETTINGS_REGISTRY[key];
      const row = await db.selectFrom('adminium_settings').selectAll().where('key', '=', key).executeTakeFirst();
      if (!row) return def.default as SettingValue<K>;
      return def.schema.parse(readJson(row.value)) as SettingValue<K>;
    },

    /** Validate and upsert an explicit override. */
    async set<K extends SettingKey>(
      key: K,
      value: SettingValue<K>,
      opts: { updatedBy?: string | null; at?: number } = {},
    ): Promise<void> {
      assertKey(key);
      const def = SETTINGS_REGISTRY[key];
      const parsed = def.schema.safeParse(value);
      if (!parsed.success) {
        throw new MetaValidationError(`invalid value for setting ${key}`, parsed.error.issues);
      }
      const at = opts.at ?? Date.now();
      const packed = packJson(parsed.data);
      const updatedBy = opts.updatedBy ?? null;
      const res = await db
        .updateTable('adminium_settings')
        .set({ value: packed, updatedAt: at, updatedBy })
        .where('key', '=', key)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) {
        await db
          .insertInto('adminium_settings')
          .values({ key, value: packed, updatedAt: at, updatedBy })
          .execute();
      }
    },

    /** Remove an override — the key falls back to the registry default. */
    async unset(key: SettingKey): Promise<boolean> {
      assertKey(key);
      const res = await db.deleteFrom('adminium_settings').where('key', '=', key).executeTakeFirst();
      return Number(res.numDeletedRows) === 1;
    },

    /** Explicit overrides only (validated); unknown/stale keys are skipped. */
    async overrides(): Promise<Partial<Record<SettingKey, unknown>>> {
      const rows = await db.selectFrom('adminium_settings').selectAll().execute();
      const out: Partial<Record<SettingKey, unknown>> = {};
      for (const row of rows) {
        if (!isSettingKey(row.key)) continue;
        const parsed = SETTINGS_REGISTRY[row.key].schema.safeParse(readJson(row.value));
        if (parsed.success) out[row.key] = parsed.data;
      }
      return out;
    },
  };
}

export type SettingsRepo = ReturnType<typeof settingsRepo>;
