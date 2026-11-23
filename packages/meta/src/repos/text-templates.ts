// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The text-message templates: one row per key and language. An app's rows
 * carry the hash of what it shipped, so an update can tell an operator's edit
 * from its own words. What a template may say is checked before it gets here
 * (`checkTextTemplate` in the manifest package).
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import type { AdminiumTextTemplatesTable } from '../schema/tables.js';
import { affected, readBool, writeBool } from './util.js';

/** The language a text falls back to when the person's own has no row. */
export const TEXT_TEMPLATE_FALLBACK_LOCALE = 'en_US';

export interface StoredTextTemplate {
  key: string;
  locale: string;
  name: string;
  body: string;
  enabled: boolean;
  managedBy: string | null;
  installId: string | null;
  contentHash: string | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertTextTemplateInput {
  name: string;
  body: string;
  enabled: boolean;
  managedBy?: string | null | undefined;
  installId?: string | null | undefined;
  contentHash?: string | null | undefined;
  updatedBy?: string | null | undefined;
}

function decode(row: Selectable<AdminiumTextTemplatesTable>): StoredTextTemplate {
  return {
    key: row.key,
    locale: row.locale,
    name: row.name,
    body: row.body,
    enabled: readBool(row.enabled),
    managedBy: row.managedBy,
    installId: row.installId,
    contentHash: row.contentHash,
    updatedBy: row.updatedBy,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export function textTemplatesRepo(meta: MetaDb) {
  const { db } = meta;

  async function findByKeyLocale(key: string, locale: string): Promise<StoredTextTemplate | null> {
    const row = await db.selectFrom('adminium_text_templates').selectAll().where('key', '=', key).where('locale', '=', locale).executeTakeFirst();
    return row === undefined ? null : decode(row);
  }

  return {
    findByKeyLocale,

    /** Every language of one template. */
    async listByKey(key: string): Promise<StoredTextTemplate[]> {
      const rows = await db.selectFrom('adminium_text_templates').selectAll().where('key', '=', key).orderBy('locale').execute();
      return rows.map(decode);
    },

    /** What a text of this key is sent with: the person's language, else US English. A switched-off row sends nothing. */
    async findSendable(key: string, locale: string): Promise<StoredTextTemplate | null> {
      const own = await findByKeyLocale(key, locale);
      if (own !== null) return own.enabled ? own : null;
      if (locale === TEXT_TEMPLATE_FALLBACK_LOCALE) return null;
      const fallback = await findByKeyLocale(key, TEXT_TEMPLATE_FALLBACK_LOCALE);
      return fallback?.enabled === true ? fallback : null;
    },

    /** Every key with a language switched on: what a rule's text step may name. */
    async liveKeys(): Promise<string[]> {
      const rows = await db.selectFrom('adminium_text_templates').select('key').where('enabled', '=', writeBool(meta, true)).distinct().orderBy('key').execute();
      return rows.map((row) => row.key);
    },

    /** An app's rows; one install's only when it is named. */
    async listManagedBy(appKey: string, installId?: string): Promise<StoredTextTemplate[]> {
      let query = db.selectFrom('adminium_text_templates').selectAll().where('managedBy', '=', appKey);
      if (installId !== undefined) query = query.where('installId', '=', installId);
      const rows = await query.orderBy('key').orderBy('locale').execute();
      return rows.map(decode);
    },

    async upsert(key: string, locale: string, input: UpsertTextTemplateInput, at: number = Date.now()): Promise<StoredTextTemplate> {
      const shared = {
        name: input.name,
        body: input.body,
        enabled: writeBool(meta, input.enabled),
        updatedBy: input.updatedBy ?? null,
        ...(input.managedBy === undefined ? {} : { managedBy: input.managedBy }),
        ...(input.installId === undefined ? {} : { installId: input.installId }),
        ...(input.contentHash === undefined ? {} : { contentHash: input.contentHash }),
      };
      const existing = await findByKeyLocale(key, locale);
      if (existing === null) await db.insertInto('adminium_text_templates').values({ key, locale, ...shared, createdAt: at, updatedAt: at }).execute();
      else await db.updateTable('adminium_text_templates').set({ ...shared, updatedAt: at }).where('key', '=', key).where('locale', '=', locale).execute();
      return (await findByKeyLocale(key, locale))!;
    },

    async remove(key: string, locale: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_text_templates').where('key', '=', key).where('locale', '=', locale).executeTakeFirst();
      return affected(res.numDeletedRows as bigint | undefined) === 1;
    },
  };
}
export type TextTemplatesRepo = ReturnType<typeof textTemplatesRepo>;
