// SPDX-License-Identifier: AGPL-3.0-only
/**
 * translationsRepo — adminium_translations (23-runtime-translations.md §3.2).
 *
 * A sparse overlay: one row per OVERRIDDEN message. Three states, and the
 * repo preserves all three faithfully (§3.3):
 *
 *   no row            → the compiled built-in renders
 *   row, value != ''  → the override renders
 *   row, value == ''  → nothing renders (a deliberate blank)
 *
 * So `remove()` is a real DELETE (that is what "reset to built-in" means) and
 * is NOT the same operation as upserting `''`. Callers must not conflate them.
 *
 * ICU validity, placeholder parity against the en-US source and the
 * a11y-critical empty-value rule are the CALLER's job (23 §6.3): they need
 * the compiled bundles and the locale's plural categories, neither of which
 * the meta store may import (01-architecture.md §2.3).
 *
 * Every mutating method bumps `settings['i18n.version']` in the same
 * transaction — see i18n-version.ts for why that lives here and not in the
 * route layer.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type { AdminiumTranslationsTable } from '../schema/tables.js';
import { bumpI18nVersion } from './i18n-version.js';
import { affected } from './util.js';

/** Reserved scope axis; always this value in v1 (§3.2). */
export const DEFAULT_TRANSLATION_SCOPE = 'workspace';

export interface TranslationRow {
  id: string;
  scope: string;
  locale: string;
  namespace: string;
  key: string;
  value: string;
  sourceText: string | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TranslationKeyRef {
  locale: string;
  namespace: string;
  key: string;
  scope?: string | undefined;
}

export interface UpsertTranslationInput extends TranslationKeyRef {
  value: string;
  /** The en-US text this override was authored against (staleness badge). */
  sourceText?: string | null | undefined;
}

function decode(row: Selectable<AdminiumTranslationsTable>): TranslationRow {
  return {
    id: row.id,
    scope: row.scope,
    locale: row.locale,
    namespace: row.namespace,
    key: row.key,
    value: row.value,
    sourceText: row.sourceText,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function translationsRepo(meta: MetaDb) {
  const { db } = meta;
  const scoped = (scope?: string | undefined): string => scope ?? DEFAULT_TRANSLATION_SCOPE;

  return {
    /**
     * Every override for one (locale, namespace) — the bundle read path.
     * Served by `ix_adminium_translations_scope_locale_ns`.
     */
    async listBundle(
      locale: string,
      namespace: string,
      opts: { scope?: string | undefined } = {},
    ): Promise<TranslationRow[]> {
      const rows = await db
        .selectFrom('adminium_translations')
        .selectAll()
        .where('scope', '=', scoped(opts.scope))
        .where('locale', '=', locale)
        .where('namespace', '=', namespace)
        .orderBy('key', 'asc')
        .execute();
      return rows.map(decode);
    },

    /** Every override for one locale, across namespaces. */
    async listLocale(
      locale: string,
      opts: { scope?: string | undefined } = {},
    ): Promise<TranslationRow[]> {
      const rows = await db
        .selectFrom('adminium_translations')
        .selectAll()
        .where('scope', '=', scoped(opts.scope))
        .where('locale', '=', locale)
        .orderBy('namespace', 'asc')
        .orderBy('key', 'asc')
        .execute();
      return rows.map(decode);
    },

    /**
     * Rows for an explicit key slice — the editor's page fetch. The key set
     * comes from an in-process search over the compiled bundles (§6.1), so
     * this stays an `IN (…)` lookup and never a portable `LIKE '%q%'` scan
     * over a growing table.
     */
    async listKeys(
      locale: string,
      namespace: string,
      keys: readonly string[],
      opts: { scope?: string | undefined } = {},
    ): Promise<TranslationRow[]> {
      if (keys.length === 0) return [];
      const rows = await db
        .selectFrom('adminium_translations')
        .selectAll()
        .where('scope', '=', scoped(opts.scope))
        .where('locale', '=', locale)
        .where('namespace', '=', namespace)
        .where('key', 'in', [...keys])
        .execute();
      return rows.map(decode);
    },

    async get(ref: TranslationKeyRef): Promise<TranslationRow | null> {
      const row = await db
        .selectFrom('adminium_translations')
        .selectAll()
        .where('scope', '=', scoped(ref.scope))
        .where('locale', '=', ref.locale)
        .where('namespace', '=', ref.namespace)
        .where('key', '=', ref.key)
        .executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /** Total override bytes for one locale over the given namespaces (§6.4 budget). */
    async byteSize(
      locale: string,
      namespaces: readonly string[],
      opts: { scope?: string | undefined } = {},
    ): Promise<number> {
      if (namespaces.length === 0) return 0;
      const rows = await db
        .selectFrom('adminium_translations')
        .select(['value'])
        .where('scope', '=', scoped(opts.scope))
        .where('locale', '=', locale)
        .where('namespace', 'in', [...namespaces])
        .execute();
      let total = 0;
      for (const row of rows) total += Buffer.byteLength(row.value, 'utf8');
      return total;
    },

    async upsert(
      input: UpsertTranslationInput,
      opts: { updatedBy?: string | null; at?: number } = {},
    ): Promise<TranslationRow> {
      const rows = await this.upsertMany([input], opts);
      const row = rows[0];
      if (row === undefined) throw new Error('upsert produced no row');
      return row;
    },

    /**
     * Bulk upsert in ONE transaction with ONE version bump. Chunking is the
     * caller's concern (23 §7 uses 100 per transaction for the copy-from job);
     * this method writes whatever it is handed atomically.
     */
    async upsertMany(
      inputs: readonly UpsertTranslationInput[],
      opts: { updatedBy?: string | null; at?: number } = {},
    ): Promise<TranslationRow[]> {
      if (inputs.length === 0) return [];
      const at = opts.at ?? Date.now();
      const updatedBy = opts.updatedBy ?? null;
      await meta.db.transaction().execute(async (trx) => {
        for (const input of inputs) {
          const scope = scoped(input.scope);
          const res = await trx
            .updateTable('adminium_translations')
            .set({
              value: input.value,
              sourceText: input.sourceText ?? null,
              updatedBy,
              updatedAt: at,
            })
            .where('scope', '=', scope)
            .where('locale', '=', input.locale)
            .where('namespace', '=', input.namespace)
            .where('key', '=', input.key)
            .executeTakeFirst();
          if (affected(res.numUpdatedRows) === 0) {
            await trx
              .insertInto('adminium_translations')
              .values({
                id: newId('trn'),
                scope,
                locale: input.locale,
                namespace: input.namespace,
                key: input.key,
                value: input.value,
                sourceText: input.sourceText ?? null,
                updatedBy,
                createdAt: at,
                updatedAt: at,
              })
              .execute();
          }
        }
        await bumpI18nVersion(trx, at, updatedBy);
      });

      const out: TranslationRow[] = [];
      for (const input of inputs) {
        const row = await this.get(input);
        if (row !== null) out.push(row);
      }
      return out;
    },

    /**
     * Reset to built-in — a hard DELETE, never an empty-string write. An
     * empty string is the third state ("render nothing"), which is a
     * different intent entirely.
     */
    async remove(
      ref: TranslationKeyRef,
      opts: { updatedBy?: string | null; at?: number } = {},
    ): Promise<boolean> {
      const at = opts.at ?? Date.now();
      let deleted = 0;
      await meta.db.transaction().execute(async (trx) => {
        const res = await trx
          .deleteFrom('adminium_translations')
          .where('scope', '=', scoped(ref.scope))
          .where('locale', '=', ref.locale)
          .where('namespace', '=', ref.namespace)
          .where('key', '=', ref.key)
          .executeTakeFirst();
        deleted = affected(res.numDeletedRows);
        if (deleted > 0) await bumpI18nVersion(trx, at, opts.updatedBy ?? null);
      });
      return deleted > 0;
    },

    /** Drop every override for a locale — used when a locale is deleted (§5.7). */
    async removeLocale(
      locale: string,
      opts: { updatedBy?: string | null; at?: number } = {},
    ): Promise<number> {
      const at = opts.at ?? Date.now();
      let deleted = 0;
      await meta.db.transaction().execute(async (trx) => {
        const res = await trx
          .deleteFrom('adminium_translations')
          .where('locale', '=', locale)
          .executeTakeFirst();
        deleted = affected(res.numDeletedRows);
        if (deleted > 0) await bumpI18nVersion(trx, at, opts.updatedBy ?? null);
      });
      return deleted;
    },

    /** Override counts per locale — the manifest's `overrideCount` (§6.1). */
    async countsByLocale(opts: { scope?: string | undefined } = {}): Promise<Map<string, number>> {
      const rows = await db
        .selectFrom('adminium_translations')
        .select(['locale'])
        .where('scope', '=', scoped(opts.scope))
        .execute();
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(row.locale, (counts.get(row.locale) ?? 0) + 1);
      return counts;
    },
  };
}
