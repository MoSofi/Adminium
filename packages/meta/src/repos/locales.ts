/**
 * localesRepo — adminium_locales (23-runtime-translations.md §3.1).
 *
 * The table is SPARSE by design and this repo is what keeps it that way: a
 * built-in locale has no row until an admin changes something about it, and
 * even then the row carries only `enabled`/`sortOrder`. Callers that need the
 * full presentation record (names, dir, font) merge these rows over the
 * compiled `LOCALES` registry from `@adminium/i18n` — the meta store cannot
 * import that package (01-architecture.md §2.3 import matrix), so the merge
 * lives in the server layer and this repo stays a dumb, typed row store.
 *
 * Every mutating method bumps `settings['i18n.version']` in the SAME
 * transaction (§3.4). The bump belongs here rather than in a route handler
 * because config-bundle import has no HTTP route at all — it writes through
 * repos — and a route-level bump would leave every client serving stale
 * strings after an import, indefinitely.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumLocalesTable } from '../schema/tables.js';
import { bumpI18nVersion } from './i18n-version.js';
import { affected, packJson, readBool, readJsonOrNull, writeBool } from './util.js';

export type LocaleDir = 'ltr' | 'rtl';
export type LocaleFontHint = 'latin' | 'arabic' | 'cjk';

export interface LocaleRow {
  id: string;
  locale: string;
  isBuiltin: boolean;
  enabled: boolean;
  sortOrder: number;
  /** Null on a built-in row — the compiled registry owns these. */
  english: string | null;
  native: string | null;
  dir: LocaleDir | null;
  fontHint: LocaleFontHint | null;
  intlTag: string | null;
  pluralCategories: string[] | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Fields a CUSTOM locale row owns outright. */
export interface CustomLocaleInput {
  english: string;
  native: string;
  dir: LocaleDir;
  fontHint: LocaleFontHint;
  /** A real BCP-47 tag whose Intl behaviour this locale borrows (§5.6). */
  intlTag: string;
  /** Frozen at create time from `intlTag` so write validation is stable. */
  pluralCategories: string[];
  enabled?: boolean | undefined;
  sortOrder?: number | undefined;
}

/** The only fields a BUILT-IN row may carry (§3.1 built-in field lock). */
export interface BuiltinLocaleInput {
  enabled?: boolean | undefined;
  sortOrder?: number | undefined;
}

function decode(row: Selectable<AdminiumLocalesTable>): LocaleRow {
  const plural = readJsonOrNull<string[]>(row.pluralCategories);
  return {
    id: row.id,
    locale: row.locale,
    isBuiltin: readBool(row.isBuiltin),
    enabled: readBool(row.enabled),
    sortOrder: row.sortOrder,
    english: row.english,
    native: row.native,
    dir: row.dir === null ? null : (row.dir as LocaleDir),
    fontHint: row.fontHint === null ? null : (row.fontHint as LocaleFontHint),
    intlTag: row.intlTag,
    pluralCategories: Array.isArray(plural) ? plural : null,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function localesRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    /** Every row, in picker order (`sortOrder`, then locale id). */
    async list(): Promise<LocaleRow[]> {
      const rows = await db
        .selectFrom('adminium_locales')
        .selectAll()
        .orderBy('sortOrder', 'asc')
        .orderBy('locale', 'asc')
        .execute();
      return rows.map(decode);
    },

    async get(locale: string): Promise<LocaleRow | null> {
      const row = await db
        .selectFrom('adminium_locales')
        .selectAll()
        .where('locale', '=', locale)
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /**
     * Create or update the row for a BUILT-IN locale. Only `enabled` and
     * `sortOrder` exist here — direction, fonts and names always come from
     * the compiled registry, so an admin cannot flip `ar_EG` to `ltr` and
     * corrupt a shipped bundle's rendering.
     */
    async upsertBuiltin(
      locale: string,
      input: BuiltinLocaleInput,
      opts: { updatedBy?: string | null; at?: number } = {},
    ): Promise<LocaleRow> {
      const at = opts.at ?? Date.now();
      const updatedBy = opts.updatedBy ?? null;
      await meta.db.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom('adminium_locales')
          .select(['id'])
          .where('locale', '=', locale)
          .executeTakeFirst();
        if (existing === undefined) {
          await trx
            .insertInto('adminium_locales')
            .values({
              id: newId('loc'),
              locale,
              isBuiltin: writeBool(meta, true),
              enabled: writeBool(meta, input.enabled ?? true),
              sortOrder: input.sortOrder ?? 0,
              english: null,
              native: null,
              dir: null,
              fontHint: null,
              intlTag: null,
              pluralCategories: null,
              updatedBy,
              createdAt: at,
              updatedAt: at,
            })
            .execute();
        } else {
          await trx
            .updateTable('adminium_locales')
            .set({
              ...(input.enabled === undefined ? {} : { enabled: writeBool(meta, input.enabled) }),
              ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
              updatedBy,
              updatedAt: at,
            })
            .where('locale', '=', locale)
            .execute();
        }
        await bumpI18nVersion(trx, at, updatedBy);
      });
      const row = await this.get(locale);
      if (row === null) throw new Error(`locale row vanished after upsert: ${locale}`);
      return row;
    },

    /** Create or update a CUSTOM locale row (the full record). */
    async upsertCustom(
      locale: string,
      input: CustomLocaleInput,
      opts: { updatedBy?: string | null; at?: number } = {},
    ): Promise<LocaleRow> {
      const at = opts.at ?? Date.now();
      const updatedBy = opts.updatedBy ?? null;
      await meta.db.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom('adminium_locales')
          .select(['id'])
          .where('locale', '=', locale)
          .executeTakeFirst();
        const shared = {
          english: input.english,
          native: input.native,
          dir: input.dir,
          fontHint: input.fontHint,
          intlTag: input.intlTag,
          pluralCategories: packJson(input.pluralCategories),
          updatedBy,
          updatedAt: at,
        };
        if (existing === undefined) {
          await trx
            .insertInto('adminium_locales')
            .values({
              id: newId('loc'),
              locale,
              isBuiltin: writeBool(meta, false),
              enabled: writeBool(meta, input.enabled ?? true),
              sortOrder: input.sortOrder ?? 0,
              createdAt: at,
              ...shared,
            })
            .execute();
        } else {
          await trx
            .updateTable('adminium_locales')
            .set({
              ...(input.enabled === undefined ? {} : { enabled: writeBool(meta, input.enabled) }),
              ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
              ...shared,
            })
            .where('locale', '=', locale)
            .execute();
        }
        await bumpI18nVersion(trx, at, updatedBy);
      });
      const row = await this.get(locale);
      if (row === null) throw new Error(`locale row vanished after upsert: ${locale}`);
      return row;
    },

    /**
     * Delete the registry row. Reassigning the users/settings/templates that
     * referenced the locale is the CALLER's job (23 §5.7) — this repo owns
     * one table and deliberately does not reach across the store.
     */
    async remove(
      locale: string,
      opts: { updatedBy?: string | null; at?: number } = {},
    ): Promise<boolean> {
      const at = opts.at ?? Date.now();
      let deleted = 0;
      await meta.db.transaction().execute(async (trx) => {
        const res = await trx
          .deleteFrom('adminium_locales')
          .where('locale', '=', locale)
          .executeTakeFirst();
        deleted = affected(res.numDeletedRows);
        if (deleted > 0) await bumpI18nVersion(trx, at, opts.updatedBy ?? null);
      });
      return deleted > 0;
    },
  };
}
