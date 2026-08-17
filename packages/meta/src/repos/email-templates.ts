// SPDX-License-Identifier: AGPL-3.0-only
/**
 * emailTemplatesRepo — adminium_email_templates (07-meta-store.md §3.28):
 * overrides of built-in email templates, unique on `(key, locale)`. The row
 * IS the template the workspace edits; `is_builtin_copy` marks rows the
 * server seeded verbatim from a built-in (true) versus rows a human has
 * touched (false — every editor write clears it, §3.28).
 *
 * `blocks` is the ordered open-record array (`emailBlocksSchema`); the
 * concrete block shape is owned by the email editor (09-generated-app.md
 * §email-editor) — the repo validates the envelope, never the block bodies.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import { emailBlocksSchema } from '../schema/json-payloads.js';
import type { AdminiumEmailTemplatesTable } from '../schema/tables.js';
import { affected, packJson, readBool, readJson, writeBool } from './util.js';

export interface EmailTemplate {
  id: string;
  key: string;
  locale: string;
  name: string;
  subject: string;
  blocks: Record<string, unknown>[];
  enabled: boolean;
  isBuiltinCopy: boolean;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertEmailTemplateInput {
  name: string;
  subject: string;
  blocks: Record<string, unknown>[];
  enabled: boolean;
  /** The editing user; null for system seeds. */
  updatedBy?: string | null | undefined;
  /** Seed writes pass true; editor writes default false (§3.28). */
  isBuiltinCopy?: boolean | undefined;
}

function decode(row: Selectable<AdminiumEmailTemplatesTable>): EmailTemplate {
  return {
    id: row.id,
    key: row.key,
    locale: row.locale,
    name: row.name,
    subject: row.subject,
    blocks: emailBlocksSchema.parse(readJson(row.blocks)) as Record<string, unknown>[],
    enabled: readBool(row.enabled),
    isBuiltinCopy: readBool(row.isBuiltinCopy),
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function emailTemplatesRepo(meta: MetaDb) {
  const { db } = meta;

  async function findByKeyLocale(key: string, locale: string): Promise<EmailTemplate | null> {
    const row = await db
      .selectFrom('adminium_email_templates')
      .selectAll()
      .where('key', '=', key)
      .where('locale', '=', locale)
      .executeTakeFirst();
    return row ? decode(row) : null;
  }

  return {
    findByKeyLocale,

    async list(): Promise<EmailTemplate[]> {
      const rows = await db
        .selectFrom('adminium_email_templates')
        .selectAll()
        .orderBy('key', 'asc')
        .orderBy('locale', 'asc')
        .execute();
      return rows.map(decode);
    },

    /**
     * `(key, locale)` upsert, portably: UPDATE first, INSERT on zero affected
     * rows (no cross-dialect ON CONFLICT — repos/util.ts convention).
     */
    async upsert(
      key: string,
      locale: string,
      input: UpsertEmailTemplateInput,
      at: number = Date.now(),
    ): Promise<EmailTemplate> {
      const blocks = packJson(emailBlocksSchema.parse(input.blocks));
      const shared = {
        name: input.name,
        subject: input.subject,
        blocks,
        enabled: writeBool(meta, input.enabled),
        isBuiltinCopy: writeBool(meta, input.isBuiltinCopy ?? false),
        updatedBy: input.updatedBy ?? null,
      };
      const res = await db
        .updateTable('adminium_email_templates')
        .set({ ...shared, updatedAt: at })
        .where('key', '=', key)
        .where('locale', '=', locale)
        .executeTakeFirst();
      if (affected(res.numUpdatedRows) === 0) {
        await db
          .insertInto('adminium_email_templates')
          .values({ id: newId('tpl'), key, locale, ...shared, createdAt: at, updatedAt: at })
          .execute();
      }
      const row = await findByKeyLocale(key, locale);
      if (row === null) throw new Error(`email template upsert lost its row: ${key}/${locale}`);
      return row;
    },

    async remove(key: string, locale: string): Promise<boolean> {
      const res = await db
        .deleteFrom('adminium_email_templates')
        .where('key', '=', key)
        .where('locale', '=', locale)
        .executeTakeFirst();
      return affected(res.numDeletedRows as bigint | undefined) === 1;
    },
  };
}

export type EmailTemplatesRepo = ReturnType<typeof emailTemplatesRepo>;
