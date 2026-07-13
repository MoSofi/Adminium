/**
 * userPrefsRepo — adminium_user_prefs (07-meta-store.md §3.4) plus the
 * BRIEF §7 preference resolution (§7.2): system default → global settings
 * override → non-NULL user axis, with `dir` derived from locale unless
 * explicitly overridden. Clearing an axis = writing NULL, not deleting the row.
 */

import { z } from 'zod';

import type { MetaDb } from '../connect.js';
import {
  accentSchema,
  densitySchema,
  dirSchema,
  localeSchema,
  themeSchema,
  uiStateSchema,
} from '../schema/json-payloads.js';
import { MetaValidationError, packJson, readJsonOrNull } from './util.js';
import { settingsRepo } from './settings.js';

export interface UserPrefs {
  userId: string;
  theme: z.infer<typeof themeSchema> | null;
  accent: z.infer<typeof accentSchema> | null;
  density: z.infer<typeof densitySchema> | null;
  locale: z.infer<typeof localeSchema> | null;
  dir: z.infer<typeof dirSchema> | null;
  uiState: Record<string, unknown> | null;
  updatedAt: number;
}

export type UserPrefsPatch = Partial<Omit<UserPrefs, 'userId' | 'updatedAt'>>;

export type PrefSource = 'system' | 'global' | 'user';

export interface ResolvedPrefs {
  theme: z.infer<typeof themeSchema>;
  accent: z.infer<typeof accentSchema>;
  density: z.infer<typeof densitySchema>;
  locale: z.infer<typeof localeSchema>;
  dir: z.infer<typeof dirSchema>;
  /** Per-axis provenance for the "using workspace default" affordances. */
  source: { theme: PrefSource; accent: PrefSource; density: PrefSource; locale: PrefSource; dir: PrefSource };
}

const AXES = {
  theme: themeSchema,
  accent: accentSchema,
  density: densitySchema,
  locale: localeSchema,
  dir: dirSchema,
} as const;

/** BRIEF §7 baseline — a fresh install without a single settings row. */
export const SYSTEM_PREF_DEFAULTS = {
  theme: 'system',
  accent: 'indigo',
  density: 'comfortable',
  locale: 'en_US',
} as const;

export function dirForLocale(locale: string): 'ltr' | 'rtl' {
  return locale === 'ar_EG' ? 'rtl' : 'ltr';
}

export function userPrefsRepo(meta: MetaDb) {
  const { db } = meta;
  const settings = settingsRepo(meta);

  async function get(userId: string): Promise<UserPrefs | null> {
    const row = await db
      .selectFrom('adminium_user_prefs')
      .selectAll()
      .where('userId', '=', userId)
      .executeTakeFirst();
    if (!row) return null;
    return {
      userId: row.userId,
      theme: row.theme === null ? null : themeSchema.parse(row.theme),
      accent: row.accent === null ? null : accentSchema.parse(row.accent),
      density: row.density === null ? null : densitySchema.parse(row.density),
      locale: row.locale === null ? null : localeSchema.parse(row.locale),
      dir: row.dir === null ? null : dirSchema.parse(row.dir),
      uiState: readJsonOrNull<Record<string, unknown>>(row.uiState),
      updatedAt: row.updatedAt,
    };
  }

  return {
    get,

    /**
     * Upsert the single prefs row. Only the axes present in `patch` change;
     * `null` clears an axis back to "inherit".
     */
    async set(userId: string, patch: UserPrefsPatch, at: number = Date.now()): Promise<UserPrefs> {
      const values: Partial<{
        theme: string | null;
        accent: string | null;
        density: string | null;
        locale: string | null;
        dir: string | null;
        uiState: string | null;
      }> = {};
      for (const axis of ['theme', 'accent', 'density', 'locale', 'dir'] as const) {
        const v = patch[axis];
        if (v === undefined) continue;
        if (v !== null) {
          const parsed = (AXES[axis] as z.ZodType<string>).safeParse(v);
          if (!parsed.success) {
            throw new MetaValidationError(`invalid pref ${axis}: ${JSON.stringify(v)}`, parsed.error.issues);
          }
        }
        values[axis] = v;
      }
      if (patch.uiState !== undefined) {
        values.uiState = patch.uiState === null ? null : packJson(uiStateSchema.parse(patch.uiState));
      }

      const res = await db
        .updateTable('adminium_user_prefs')
        .set({ ...values, updatedAt: at })
        .where('userId', '=', userId)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) {
        await db
          .insertInto('adminium_user_prefs')
          .values({
            userId,
            theme: values.theme ?? null,
            accent: values.accent ?? null,
            density: values.density ?? null,
            locale: values.locale ?? null,
            dir: values.dir ?? null,
            uiState: values.uiState ?? null,
            updatedAt: at,
          })
          .execute();
      }
      const row = await get(userId);
      if (!row) throw new Error('user prefs row disappeared during set');
      return row;
    },

    /** §7.2 merge, implemented exactly once, server-side. */
    async resolve(userId: string | null): Promise<ResolvedPrefs> {
      const glob = {
        theme: await settings.get('appearance.theme'),
        accent: await settings.get('appearance.accent'),
        density: await settings.get('appearance.density'),
        locale: await settings.get('locale.default'),
      };
      const globIsDefault = {
        theme: glob.theme === SYSTEM_PREF_DEFAULTS.theme,
        accent: glob.accent === SYSTEM_PREF_DEFAULTS.accent,
        density: glob.density === SYSTEM_PREF_DEFAULTS.density,
        locale: glob.locale === SYSTEM_PREF_DEFAULTS.locale,
      };
      const user = userId === null ? null : await get(userId);

      const pick = <K extends 'theme' | 'accent' | 'density' | 'locale'>(
        axis: K,
      ): { value: ResolvedPrefs[K]; source: PrefSource } => {
        const u = user?.[axis];
        if (u !== null && u !== undefined) {
          return { value: u as unknown as ResolvedPrefs[K], source: 'user' };
        }
        return {
          value: glob[axis] as unknown as ResolvedPrefs[K],
          source: globIsDefault[axis] ? 'system' : 'global',
        };
      };

      const theme = pick('theme');
      const accent = pick('accent');
      const density = pick('density');
      const locale = pick('locale');
      const dir =
        user?.dir !== null && user?.dir !== undefined
          ? { value: user.dir, source: 'user' as PrefSource }
          : { value: dirForLocale(locale.value), source: locale.source };

      return {
        theme: theme.value,
        accent: accent.value,
        density: density.value,
        locale: locale.value,
        dir: dir.value,
        source: {
          theme: theme.source,
          accent: accent.source,
          density: density.source,
          locale: locale.source,
          dir: dir.source,
        },
      };
    },
  };
}

export type UserPrefsRepo = ReturnType<typeof userPrefsRepo>;
