// SPDX-License-Identifier: AGPL-3.0-only
/**
 * invoiceDocumentsRepo — adminium_invoice_documents (wave 0027). One table,
 * two kinds: a `template` is a reusable design, an `invoice` is a document
 * built from one or from scratch. Both carry the same envelope in `body`;
 * the row's `kind`, `name`, `status`, `topic` and `lang` are columns.
 *
 * THIS IS THE AUTHORED SOURCE, NOT A REGISTER. `adminium_documents` (a
 * later wave) records what was rendered; this table holds what a person
 * typed and can edit again. Deleting a template never touches an invoice
 * built from it — `originId` is a soft reference by design.
 *
 * `body` is the OPEN record (`invoiceBodySchema`); the concrete field shape
 * is owned by `apps/server/src/invoices/document.ts` — the repo validates the
 * envelope's enums and the summary, never the body's fields, so a body a
 * newer server wrote round-trips byte-identical (the email repo's rule).
 *
 * POSITION IS THE COMP'S ARRAY INDEX. The manager orders each kind by
 * `position` and the comp's three placements are reproduced here as
 * arithmetic on it, each inside one transaction:
 *
 *   `{ at: 'first' }`      — position = min − 1 (a new document is prepended,
 *                            comp `createFrom` 1381)
 *   `{ after: id }`        — every row of that kind past the source moves +1
 *                            and the new row takes source + 1 (a duplicate
 *                            lands directly after its source, comp 1384)
 *   `{ afterTopic }`       — after the last row of that kind + topic (a
 *                            language variation joins its family, comp
 *                            `addLangVariant` 1247-1251); no such row → the
 *                            end of the kind
 *
 * A source that no longer exists is placed at the end rather than refused:
 * the route has already answered 404 for a missing row, so the fallback only
 * ever covers a race, and losing the document would be the worse outcome.
 */

import type { Kysely, Selectable, Transaction } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  INVOICE_LANG_ORDER,
  invoiceBodySchema,
  invoiceDocumentKindSchema,
  invoiceLangSchema,
  invoiceStatusSchema,
  invoiceSummarySchema,
  invoiceTopicSchema,
  type InvoiceBodyRecord,
  type InvoiceDocumentKind,
  type InvoiceLang,
  type InvoiceStatus,
  type InvoiceSummary,
  type InvoiceTopic,
} from '../schema/json-payloads.js';
import type { AdminiumInvoiceDocumentsTable, MetaDB } from '../schema/tables.js';
import { affected, packJson, readJson } from './util.js';

export interface InvoiceDocument {
  id: string;
  kind: InvoiceDocumentKind;
  name: string;
  status: InvoiceStatus;
  topic: InvoiceTopic;
  lang: InvoiceLang;
  /** Denormalised from `body.number`. */
  number: string;
  /** Which starter minted it; null for blank documents. */
  starter: string | null;
  /** The template an invoice was built from; null otherwise. */
  originId: string | null;
  /** The manager's sort key within the kind. */
  position: number;
  body: InvoiceBodyRecord;
  summary: InvoiceSummary;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateInvoiceDocumentInput {
  kind: InvoiceDocumentKind;
  name: string;
  status?: InvoiceStatus | undefined;
  topic?: InvoiceTopic | undefined;
  lang?: InvoiceLang | undefined;
  number?: string | undefined;
  starter?: string | null | undefined;
  originId?: string | null | undefined;
  body: InvoiceBodyRecord;
  summary: InvoiceSummary;
  createdBy?: string | null | undefined;
}

/** Everything a save or a rename may change; absent = untouched. */
export interface PatchInvoiceDocumentInput {
  name?: string | undefined;
  status?: InvoiceStatus | undefined;
  topic?: InvoiceTopic | undefined;
  lang?: InvoiceLang | undefined;
  body?: InvoiceBodyRecord | undefined;
  summary?: InvoiceSummary | undefined;
  number?: string | undefined;
}

/** Where a new row lands in its kind's order — see the header. */
export type InvoicePlacement =
  | { at: 'first' }
  | { after: string }
  | { afterTopic: { kind: InvoiceDocumentKind; topic: InvoiceTopic } };

export interface ListInvoiceDocumentsFilter {
  kind?: InvoiceDocumentKind | undefined;
}

/** The manager's tab badges — ALWAYS unfiltered (the comp's badges never respond to the search box, 1423). */
export interface InvoiceDocumentCounts {
  template: number;
  invoice: number;
}

function decode(row: Selectable<AdminiumInvoiceDocumentsTable>): InvoiceDocument {
  return {
    id: row.id,
    kind: invoiceDocumentKindSchema.parse(row.kind),
    name: row.name,
    status: invoiceStatusSchema.parse(row.status),
    topic: invoiceTopicSchema.parse(row.topic),
    lang: invoiceLangSchema.parse(row.lang),
    number: row.number,
    starter: row.starter,
    originId: row.originId,
    position: Number(row.position),
    body: invoiceBodySchema.parse(readJson(row.body)),
    summary: invoiceSummarySchema.parse(readJson(row.summary)),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The comp's fixed language order (1185-1190); an unknown code sorts last. */
export function invoiceLangRank(lang: string): number {
  const index = (INVOICE_LANG_ORDER as readonly string[]).indexOf(lang);
  return index === -1 ? INVOICE_LANG_ORDER.length : index;
}

type Db = Kysely<MetaDB> | Transaction<MetaDB>;

export function invoiceDocumentsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<InvoiceDocument | null> {
    const row = await db.selectFrom('adminium_invoice_documents').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? decode(row) : null;
  }

  /** `max(position) + 1` over the kind — the end of its list; 0 for an empty kind. */
  async function endOf(trx: Db, kind: InvoiceDocumentKind): Promise<number> {
    const row = await trx
      .selectFrom('adminium_invoice_documents')
      .select(({ fn }) => fn.max<number | null>('position').as('n'))
      .where('kind', '=', kind)
      .executeTakeFirst();
    return row?.n === null || row?.n === undefined ? 0 : Number(row.n) + 1;
  }

  /** Open a gap at `position + 1` within the kind by moving every later row one down. */
  async function openGapAfter(trx: Db, kind: InvoiceDocumentKind, position: number): Promise<number> {
    await trx
      .updateTable('adminium_invoice_documents')
      .set((eb) => ({ position: eb('position', '+', 1) }))
      .where('kind', '=', kind)
      .where('position', '>', position)
      .execute();
    return position + 1;
  }

  /** The position a new row of `kind` takes under `placement` — the header's arithmetic. */
  async function placeAt(trx: Db, kind: InvoiceDocumentKind, placement: InvoicePlacement): Promise<number> {
    if ('at' in placement) {
      const row = await trx
        .selectFrom('adminium_invoice_documents')
        .select(({ fn }) => fn.min<number | null>('position').as('n'))
        .where('kind', '=', kind)
        .executeTakeFirst();
      return row?.n === null || row?.n === undefined ? 0 : Number(row.n) - 1;
    }
    if ('after' in placement) {
      const source = await trx
        .selectFrom('adminium_invoice_documents')
        .select(['kind', 'position'])
        .where('id', '=', placement.after)
        .executeTakeFirst();
      if (source === undefined || source.kind !== kind) return await endOf(trx, kind);
      return await openGapAfter(trx, kind, Number(source.position));
    }
    const last = await trx
      .selectFrom('adminium_invoice_documents')
      .select(({ fn }) => fn.max<number | null>('position').as('n'))
      .where('kind', '=', placement.afterTopic.kind)
      .where('topic', '=', invoiceTopicSchema.parse(placement.afterTopic.topic))
      .executeTakeFirst();
    if (last?.n === null || last?.n === undefined) return await endOf(trx, kind);
    return await openGapAfter(trx, kind, Number(last.n));
  }

  return {
    findById,

    /** The manager's list: one kind, or both, in the comp's array order. */
    async list(filter: ListInvoiceDocumentsFilter = {}): Promise<InvoiceDocument[]> {
      let q = db.selectFrom('adminium_invoice_documents').selectAll();
      if (filter.kind !== undefined) q = q.where('kind', '=', invoiceDocumentKindSchema.parse(filter.kind));
      const rows = await q.orderBy('position', 'asc').orderBy('id', 'asc').execute();
      return rows.map(decode);
    },

    /** Tab badges — never filtered. */
    async counts(): Promise<InvoiceDocumentCounts> {
      const byKind = await db
        .selectFrom('adminium_invoice_documents')
        .select(['kind', ({ fn }) => fn.countAll<number>().as('n')])
        .groupBy('kind')
        .execute();
      const counts: InvoiceDocumentCounts = { template: 0, invoice: 0 };
      for (const row of byKind) {
        const kind = invoiceDocumentKindSchema.safeParse(row.kind);
        if (kind.success) counts[kind.data] = Number(row.n);
      }
      return counts;
    },

    /**
     * Every row of a kind sharing a topic — a language family, this row
     * included — in the comp's language order (en · de · fr · es · pt · ja),
     * then by position, so the menu and the group header agree.
     */
    async siblings(kind: InvoiceDocumentKind, topic: InvoiceTopic): Promise<InvoiceDocument[]> {
      const rows = await db
        .selectFrom('adminium_invoice_documents')
        .selectAll()
        .where('kind', '=', invoiceDocumentKindSchema.parse(kind))
        .where('topic', '=', invoiceTopicSchema.parse(topic))
        .execute();
      return rows
        .map(decode)
        .sort((a, b) => invoiceLangRank(a.lang) - invoiceLangRank(b.lang) || a.position - b.position || (a.id < b.id ? -1 : 1));
    },

    /** True when a row of `kind` already carries `number` (the minting loop's question). */
    async numberExists(kind: InvoiceDocumentKind, number: string): Promise<boolean> {
      const row = await db
        .selectFrom('adminium_invoice_documents')
        .select('id')
        .where('kind', '=', invoiceDocumentKindSchema.parse(kind))
        .where('number', '=', number)
        .executeTakeFirst();
      return row !== undefined;
    },

    /** A new row at `placement` (default: first), the position arithmetic and the insert in one transaction. */
    async create(
      input: CreateInvoiceDocumentInput,
      at: number = Date.now(),
      placement: InvoicePlacement = { at: 'first' },
    ): Promise<InvoiceDocument> {
      const kind = invoiceDocumentKindSchema.parse(input.kind);
      const id = newId('inv');
      await db.transaction().execute(async (trx) => {
        const position = await placeAt(trx, kind, placement);
        await trx
          .insertInto('adminium_invoice_documents')
          .values({
            id,
            kind,
            name: input.name,
            status: invoiceStatusSchema.parse(input.status ?? 'draft'),
            topic: invoiceTopicSchema.parse(input.topic ?? 'other'),
            lang: invoiceLangSchema.parse(input.lang ?? 'en'),
            number: input.number ?? '',
            starter: input.starter ?? null,
            originId: input.originId ?? null,
            position,
            body: packJson(invoiceBodySchema.parse(input.body)),
            summary: packJson(invoiceSummarySchema.parse(input.summary)),
            createdBy: input.createdBy ?? null,
            createdAt: at,
            updatedAt: at,
          })
          .execute();
      });
      const row = await findById(id);
      if (row === null) throw new Error(`invoice document insert lost its row: ${id}`);
      return row;
    },

    /** The explicit save and the rename; null when the row does not exist. */
    async patch(id: string, input: PatchInvoiceDocumentInput, at: number = Date.now()): Promise<InvoiceDocument | null> {
      const set = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.status === undefined ? {} : { status: invoiceStatusSchema.parse(input.status) }),
        ...(input.topic === undefined ? {} : { topic: invoiceTopicSchema.parse(input.topic) }),
        ...(input.lang === undefined ? {} : { lang: invoiceLangSchema.parse(input.lang) }),
        ...(input.body === undefined ? {} : { body: packJson(invoiceBodySchema.parse(input.body)) }),
        ...(input.summary === undefined ? {} : { summary: packJson(invoiceSummarySchema.parse(input.summary)) }),
        ...(input.number === undefined ? {} : { number: input.number }),
        updatedAt: at,
      };
      const res = await db.updateTable('adminium_invoice_documents').set(set).where('id', '=', id).executeTakeFirst();
      if (affected(res.numUpdatedRows) === 0) return null;
      return await findById(id);
    },

    /** Hard delete — this surface has no archive (the comp's `doDelete`, 1386). */
    async removeById(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_invoice_documents').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows as bigint | undefined) === 1;
    },
  };
}

export type InvoiceDocumentsRepo = ReturnType<typeof invoiceDocumentsRepo>;
