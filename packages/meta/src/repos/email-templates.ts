// SPDX-License-Identifier: AGPL-3.0-only
/**
 * emailTemplatesRepo — adminium_email_templates. One table, two kinds: a
 * `template` is a document the product sends (a password reset, an invite,
 * a notification) or an operator's reusable design; a `campaign` is a
 * send-out — the same envelope with a run history.
 *
 * `is_builtin_copy` marks rows the server seeded verbatim from a built-in
 * (true) versus rows a human has touched (false — every editor write clears
 * it). A `(key, locale)` pair is one language variation of one topic:
 * siblings share the `key`.
 *
 * `blocks` is the ordered open-record array (`emailBlocksSchema`); the
 * concrete per-kind shapes are owned by `apps/server/src/email/document.ts`
 * — the repo validates the envelope, never the block bodies, so an unknown
 * kind round-trips byte-identical.
 *
 * THE FOOTER IS LIFTED ON DECODE. The comp's footer is a fixed envelope
 * field, but every seeded row and every install's edits hold a trailing
 * `email.footer` BLOCK. When a row's `footer` column is empty and its last
 * block is a footer, {@link liftLegacyFooter} moves the text onto the
 * envelope and drops the block from what the caller sees. Nothing is
 * rewritten in place: the next explicit save stores `footer` as a field, and
 * a row that is never saved keeps its block forever — which the renderer
 * still renders. The seed's change detection compares the lifted shape
 * against a built-in that carries `footer` the same way.
 */

import { randomBytes } from 'node:crypto';

import { sql, type Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  emailAttachmentsSchema,
  emailBlocksSchema,
  emailBrandSchema,
  emailCategorySchema,
  emailDocumentKindSchema,
  emailMirrorOpsSchema,
  type EmailAttachment,
  type EmailBrand,
  type EmailCategory,
  type EmailDocumentKind,
  type EmailMirrorOp,
} from '../schema/json-payloads.js';
import type { AdminiumEmailTemplatesTable } from '../schema/tables.js';
import { affected, packJson, readBool, readJson, readJsonOrNull, writeBool } from './util.js';

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
  kind: EmailDocumentKind;
  category: EmailCategory;
  /** Which starter minted the family; null for blank and built-in documents. */
  starter: string | null;
  needsTranslation: boolean;
  /** Delete is archive; null = live in the manager. */
  archivedAt: number | null;
  preheader: string;
  /** The fixed footer — lifted from a trailing legacy footer block on read. */
  footer: string;
  /** Per-document brand & sender; null = workspace defaults. */
  brand: EmailBrand | null;
  attachments: EmailAttachment[];
  createdBy: string | null;
  /** The app that shipped it; null for the operator's own and the built-ins. */
  managedBy: string | null;
  /** The hash of what the app shipped: a row that no longer hashes to it was edited. */
  contentHash: string | null;
}

/** The envelope fields every write may carry beyond the M7 five. */
export interface EmailEnvelopeInput {
  category?: EmailCategory | undefined;
  starter?: string | null | undefined;
  needsTranslation?: boolean | undefined;
  preheader?: string | undefined;
  footer?: string | undefined;
  brand?: EmailBrand | null | undefined;
  attachments?: EmailAttachment[] | undefined;
}

export interface UpsertEmailTemplateInput extends EmailEnvelopeInput {
  name: string;
  subject: string;
  blocks: Record<string, unknown>[];
  enabled: boolean;
  /** The editing user; null for system seeds. */
  updatedBy?: string | null | undefined;
  /** Seed writes pass true; editor writes default false. */
  isBuiltinCopy?: boolean | undefined;
  /** An app's install writes its key here, with the hash of what it wrote. */
  managedBy?: string | null | undefined;
  contentHash?: string | null | undefined;
}

export interface CreateEmailTemplateInput extends EmailEnvelopeInput {
  kind: EmailDocumentKind;
  key: string;
  locale: string;
  name: string;
  subject: string;
  blocks: Record<string, unknown>[];
  enabled?: boolean | undefined;
  isBuiltinCopy?: boolean | undefined;
  createdBy?: string | null | undefined;
}

/** Everything `PUT`/`PATCH` may change; absent = untouched. */
export interface PatchEmailTemplateInput extends EmailEnvelopeInput {
  name?: string | undefined;
  subject?: string | undefined;
  blocks?: Record<string, unknown>[] | undefined;
  enabled?: boolean | undefined;
  /** Editor writes pass false explicitly; the reset path passes true. */
  isBuiltinCopy?: boolean | undefined;
  updatedBy?: string | null | undefined;
}

export interface ListEmailTemplatesFilter {
  kind?: EmailDocumentKind | undefined;
  /** Default false: the live documents. True lists the Archived view. */
  archived?: boolean | undefined;
  /** Case-insensitive substring over name, subject, category and key. */
  q?: string | undefined;
}

/** The manager's tab badges and the Archived count (`counts`). */
export interface EmailTemplateCounts {
  /** Documents of each kind in the requested archived state. */
  template: number;
  campaign: number;
  /** Archived documents of every kind. */
  archived: number;
}

/** `(key, locale)` is unique; the repo refuses before the index does so the caller gets a typed reason. */
export class EmailTemplateExistsError extends Error {
  override readonly name = 'EmailTemplateExistsError';
  constructor(
    readonly key: string,
    readonly locale: string,
  ) {
    super(`an email document ${key}/${locale} already exists`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The read-side half of: a trailing `email.footer` block becomes the
 * envelope's `footer` when the column is empty. Exported so the server can
 * apply the same rule to a document arriving on the wire (an old export, a
 * hand-written bundle) before validating it.
 */
export function liftLegacyFooter(
  blocks: readonly Record<string, unknown>[],
  footer: string,
): { blocks: Record<string, unknown>[]; footer: string } {
  const copy = [...blocks];
  if (footer !== '') return { blocks: copy, footer };
  const last = copy.at(-1);
  if (last === undefined || last['block'] !== 'email.footer') return { blocks: copy, footer };
  const data = last['data'];
  const text = isRecord(data) && typeof data['text'] === 'string' ? data['text'] : '';
  return { blocks: copy.slice(0, -1), footer: text };
}

/** A fresh block id for a clone — short, unguessable enough, never colliding within one document. */
export function newEmailBlockId(): string {
  return `b_${randomBytes(6).toString('base64url')}`;
}

function cloneBlock(block: Record<string, unknown>): Record<string, unknown> {
  return { ...(JSON.parse(JSON.stringify(block)) as Record<string, unknown>), id: newEmailBlockId() };
}

/**
 * The comp's `applyOp` (comp 1317-1323), with every index clamped to the list
 * it is applied to: the same op runs against siblings of different lengths, so
 * an index past the end inserts at the end, deletes nothing, and a move that
 * names a missing block is a no-op. `cloneIds` mints fresh ids on inserted
 * blocks — a mirrored insert must not share an id with the original.
 */
export function applyEmailBlockOps(
  blocks: readonly Record<string, unknown>[],
  ops: readonly EmailMirrorOp[],
  opts: { cloneIds: boolean },
): Record<string, unknown>[] {
  let list = [...blocks];
  for (const op of ops) {
    switch (op.kind) {
      case 'insert': {
        const block = opts.cloneIds ? cloneBlock(op.block) : op.block;
        list.splice(Math.min(op.index, list.length), 0, block);
        break;
      }
      case 'delete':
        if (op.index < list.length) list.splice(op.index, 1);
        break;
      case 'move': {
        if (op.from >= list.length || op.from === op.to) break;
        const next = [...list];
        const [moved] = next.splice(op.from, 1);
        if (moved === undefined) break;
        const to = Math.min(op.to, list.length);
        next.splice(Math.min(op.from < to ? to - 1 : to, next.length), 0, moved);
        list = next;
        break;
      }
    }
  }
  return list;
}

function decode(row: Selectable<AdminiumEmailTemplatesTable>): EmailTemplate {
  const lifted = liftLegacyFooter(
    emailBlocksSchema.parse(readJson(row.blocks)) as Record<string, unknown>[],
    row.footer ?? '',
  );
  const brandRaw = readJsonOrNull(row.brand);
  const attachmentsRaw = readJsonOrNull(row.attachments);
  return {
    id: row.id,
    key: row.key,
    locale: row.locale,
    name: row.name,
    subject: row.subject,
    blocks: lifted.blocks,
    enabled: readBool(row.enabled),
    isBuiltinCopy: readBool(row.isBuiltinCopy),
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    kind: emailDocumentKindSchema.parse(row.kind),
    category: emailCategorySchema.parse(row.category),
    starter: row.starter,
    needsTranslation: readBool(row.needsTranslation),
    archivedAt: row.archivedAt,
    preheader: row.preheader,
    footer: lifted.footer,
    brand: brandRaw === null ? null : emailBrandSchema.parse(brandRaw),
    attachments: attachmentsRaw === null ? [] : emailAttachmentsSchema.parse(attachmentsRaw),
    createdBy: row.createdBy,
    managedBy: row.managedBy,
    contentHash: row.contentHash,
  };
}

/** Escape LIKE wildcards in the user-supplied search term (usersRepo's rule). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * `en_US` first — ALWAYS, it is the source language every family starts in
 * and the fallback every send resolves to — then the caller's order when one
 * is given (the registry's picker order, which ties on `sortOrder` and would
 * otherwise put `ar_EG` ahead of everything), then the rest by id.
 * Deterministic without the i18n registry, which this package may not
 * import.
 */
export function compareLocales(a: string, b: string, localeOrder?: readonly string[]): number {
  if (a === b) return 0;
  if (a === 'en_US') return -1;
  if (b === 'en_US') return 1;
  if (localeOrder !== undefined) {
    const ia = localeOrder.indexOf(a);
    const ib = localeOrder.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      if (ia !== ib) return ia - ib;
    }
  }
  return a < b ? -1 : 1;
}

export function emailTemplatesRepo(meta: MetaDb) {
  const { db } = meta;

  function envelopeColumns(input: EmailEnvelopeInput): Partial<{
    category: string;
    starter: string | null;
    needsTranslation: boolean | 0 | 1;
    preheader: string;
    footer: string;
    brand: string | null;
    attachments: string;
  }> {
    return {
      ...(input.category === undefined ? {} : { category: emailCategorySchema.parse(input.category) }),
      ...(input.starter === undefined ? {} : { starter: input.starter }),
      ...(input.needsTranslation === undefined
        ? {}
        : { needsTranslation: writeBool(meta, input.needsTranslation) }),
      ...(input.preheader === undefined ? {} : { preheader: input.preheader }),
      ...(input.footer === undefined ? {} : { footer: input.footer }),
      ...(input.brand === undefined
        ? {}
        : { brand: input.brand === null ? null : packJson(emailBrandSchema.parse(input.brand)) }),
      ...(input.attachments === undefined
        ? {}
        : { attachments: packJson(emailAttachmentsSchema.parse(input.attachments)) }),
    };
  }

  async function findById(id: string): Promise<EmailTemplate | null> {
    const row = await db
      .selectFrom('adminium_email_templates')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? decode(row) : null;
  }

  async function findByKeyLocale(key: string, locale: string): Promise<EmailTemplate | null> {
    const row = await db
      .selectFrom('adminium_email_templates')
      .selectAll()
      .where('key', '=', key)
      .where('locale', '=', locale)
      .executeTakeFirst();
    return row ? decode(row) : null;
  }

  async function patch(
    id: string,
    input: PatchEmailTemplateInput,
    at: number = Date.now(),
  ): Promise<EmailTemplate | null> {
    const set = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.subject === undefined ? {} : { subject: input.subject }),
      ...(input.blocks === undefined ? {} : { blocks: packJson(emailBlocksSchema.parse(input.blocks)) }),
      ...(input.enabled === undefined ? {} : { enabled: writeBool(meta, input.enabled) }),
      ...(input.isBuiltinCopy === undefined
        ? {}
        : { isBuiltinCopy: writeBool(meta, input.isBuiltinCopy) }),
      ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
      ...envelopeColumns(input),
      updatedAt: at,
    };
    const res = await db
      .updateTable('adminium_email_templates')
      .set(set)
      .where('id', '=', id)
      .executeTakeFirst();
    if (affected(res.numUpdatedRows) === 0) return null;
    return await findById(id);
  }

  return {
    findById,
    findByKeyLocale,

    /**
     * The manager's list: live documents by default, the Archived view on
     * request, both kinds unless `kind` narrows. Ordered by topic (`key`),
     * `en_US` first within a topic, then the other locales by id — so a
     * family's variants sit together with the source language on top.
     */
    async list(filter: ListEmailTemplatesFilter = {}): Promise<EmailTemplate[]> {
      let q = db
        .selectFrom('adminium_email_templates')
        .selectAll()
        .where('archivedAt', filter.archived === true ? 'is not' : 'is', null);
      if (filter.kind !== undefined) q = q.where('kind', '=', emailDocumentKindSchema.parse(filter.kind));
      const term = filter.q?.trim() ?? '';
      if (term.length > 0) {
        const like = `%${escapeLike(term.toLowerCase())}%`;
        q = q.where((eb) =>
          eb.or([
            eb(eb.fn<string>('lower', ['name']), 'like', like),
            eb(eb.fn<string>('lower', ['subject']), 'like', like),
            eb('category', 'like', like),
            eb('key', 'like', like),
          ]),
        );
      }
      const rows = await q
        .orderBy('key', 'asc')
        .orderBy(sql`case when locale = 'en_US' then 0 else 1 end`, 'asc')
        .orderBy('locale', 'asc')
        .execute();
      return rows.map(decode);
    },

    /** Tab badges for the requested archived state, plus the Archived total. */
    async counts(archived = false): Promise<EmailTemplateCounts> {
      const byKind = await db
        .selectFrom('adminium_email_templates')
        .select(['kind', ({ fn }) => fn.countAll<number>().as('n')])
        .where('archivedAt', archived ? 'is not' : 'is', null)
        .groupBy('kind')
        .execute();
      const archivedRow = await db
        .selectFrom('adminium_email_templates')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .where('archivedAt', 'is not', null)
        .executeTakeFirst();
      const counts: EmailTemplateCounts = { template: 0, campaign: 0, archived: Number(archivedRow?.n ?? 0) };
      for (const row of byKind) {
        const kind = emailDocumentKindSchema.safeParse(row.kind);
        if (kind.success) counts[kind.data] = Number(row.n);
      }
      return counts;
    },

    /**
     * Every variation of a topic, archived ones included (callers filter on
     * `archivedAt`), in locale order — the registry's picker order when the
     * caller passes it, else `en_US` first.
     */
    async siblings(key: string, opts: { localeOrder?: readonly string[] | undefined } = {}): Promise<EmailTemplate[]> {
      const rows = await db
        .selectFrom('adminium_email_templates')
        .selectAll()
        .where('key', '=', key)
        .execute();
      return rows.map(decode).sort((a, b) => compareLocales(a.locale, b.locale, opts.localeOrder));
    },

    /**
     * Keys that would collide with a minted `base` — the key itself and every
     * `base-N` — so the server can pick the next free suffix in one query
     * (`weekly-digest`, `weekly-digest-2`). Archived rows count: their `(key,
     * locale)` still occupies the unique index.
     */
    async keysLike(base: string): Promise<string[]> {
      const rows = await db
        .selectFrom('adminium_email_templates')
        .select('key')
        .distinct()
        .where((eb) => eb.or([eb('key', '=', base), eb('key', 'like', `${escapeLike(base)}-%`)]))
        .execute();
      return rows.map((row) => row.key);
    },

    /** A new document; refuses a `(key, locale)` that exists, archived or not. */
    async create(input: CreateEmailTemplateInput, at: number = Date.now()): Promise<EmailTemplate> {
      if ((await findByKeyLocale(input.key, input.locale)) !== null) {
        throw new EmailTemplateExistsError(input.key, input.locale);
      }
      const id = newId('tpl');
      await db
        .insertInto('adminium_email_templates')
        .values({
          id,
          key: input.key,
          locale: input.locale,
          name: input.name,
          subject: input.subject,
          blocks: packJson(emailBlocksSchema.parse(input.blocks)),
          enabled: writeBool(meta, input.enabled ?? true),
          isBuiltinCopy: writeBool(meta, input.isBuiltinCopy ?? false),
          updatedBy: input.createdBy ?? null,
          createdAt: at,
          updatedAt: at,
          kind: emailDocumentKindSchema.parse(input.kind),
          category: emailCategorySchema.parse(input.category ?? 'transactional'),
          starter: input.starter ?? null,
          needsTranslation: writeBool(meta, input.needsTranslation ?? false),
          archivedAt: null,
          preheader: input.preheader ?? '',
          footer: input.footer ?? '',
          brand: input.brand === undefined || input.brand === null ? null : packJson(emailBrandSchema.parse(input.brand)),
          attachments: packJson(emailAttachmentsSchema.parse(input.attachments ?? [])),
          createdBy: input.createdBy ?? null,
        })
        .execute();
      const row = await findById(id);
      if (row === null) throw new Error(`email document insert lost its row: ${id}`);
      return row;
    },

    patch,

    /** Delete is archive. Returns the row, or null when it does not exist. */
    async archive(id: string, at: number = Date.now()): Promise<EmailTemplate | null> {
      const res = await db
        .updateTable('adminium_email_templates')
        .set({ archivedAt: at, updatedAt: at })
        .where('id', '=', id)
        .where('archivedAt', 'is', null)
        .executeTakeFirst();
      void res;
      return await findById(id);
    },

    async restore(id: string, at: number = Date.now()): Promise<EmailTemplate | null> {
      await db
        .updateTable('adminium_email_templates')
        .set({ archivedAt: null, updatedAt: at })
        .where('id', '=', id)
        .where('archivedAt', 'is not', null)
        .execute();
      return await findById(id);
    },

    /** Delete for good; runs cascade with the row. */
    async removeById(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_email_templates').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows as bigint | undefined) === 1;
    },

    /**
     * Apply the session's structural ops to every LIVE sibling of `id` — not
     * to `id` itself, whose document the same save writes verbatim — inside
     * one transaction, cloning inserted blocks with fresh ids. Returns the
     * siblings it changed.
     */
    async applyMirrorOps(
      id: string,
      ops: readonly EmailMirrorOp[],
      opts: { updatedBy?: string | null | undefined; at?: number | undefined } = {},
    ): Promise<EmailTemplate[]> {
      const parsed = emailMirrorOpsSchema.parse(ops);
      if (parsed.length === 0) return [];
      const source = await findById(id);
      if (source === null) return [];
      const at = opts.at ?? Date.now();
      return await db.transaction().execute(async (trx) => {
        const rows = await trx
          .selectFrom('adminium_email_templates')
          .selectAll()
          .where('key', '=', source.key)
          .where('id', '!=', id)
          .where('archivedAt', 'is', null)
          .execute();
        const changed: EmailTemplate[] = [];
        for (const raw of rows) {
          const sibling = decode(raw);
          const blocks = applyEmailBlockOps(sibling.blocks, parsed, { cloneIds: true });
          await trx
            .updateTable('adminium_email_templates')
            .set({
              blocks: packJson(blocks),
              // A mirrored edit is a human edit of this variant too.
              isBuiltinCopy: writeBool(meta, false),
              // The lift is read-side; persist what the caller now sees so the
              // legacy footer block is not resurrected from the stored array.
              footer: sibling.footer,
              updatedAt: at,
              ...(opts.updatedBy === undefined ? {} : { updatedBy: opts.updatedBy }),
            })
            .where('id', '=', sibling.id)
            .execute();
          changed.push({ ...sibling, blocks, footer: sibling.footer, isBuiltinCopy: false, updatedAt: at });
        }
        return changed;
      });
    },

    /**
     * `(key, locale)` upsert, portably: UPDATE first, INSERT on zero affected
     * rows (no cross-dialect ON CONFLICT — repos/util.ts convention). The seed's
     * verb; it never touches `kind` (a seeded key is always a template) and
     * leaves `archived_at` alone — an archived row is human-owned, and the seed
     * checks that before calling.
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
        ...envelopeColumns(input),
        ...(input.managedBy === undefined ? {} : { managedBy: input.managedBy }),
        ...(input.contentHash === undefined ? {} : { contentHash: input.contentHash }),
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
          .values({
            id: newId('tpl'),
            key,
            locale,
            kind: 'template',
            // The column defaults, stated: Kysely's insert type wants every
            // NOT NULL column, and the envelope (if given) overrides them.
            category: 'transactional',
            needsTranslation: writeBool(meta, false),
            preheader: '',
            ...shared,
            createdAt: at,
            updatedAt: at,
          })
          .execute();
      }
      const row = await findByKeyLocale(key, locale);
      if (row === null) throw new Error(`email template upsert lost its row: ${key}/${locale}`);
      return row;
    },

    /** Every row an app shipped, archived ones included, by key then locale. */
    async listManagedBy(appKey: string): Promise<EmailTemplate[]> {
      const rows = await db
        .selectFrom('adminium_email_templates')
        .selectAll()
        .where('managedBy', '=', appKey)
        .orderBy('key')
        .orderBy('locale')
        .execute();
      return rows.map(decode);
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
