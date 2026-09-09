// SPDX-License-Identifier: AGPL-3.0-only
/**
 * reportDocumentsRepo — adminium_report_documents (43-report-builder.md
 * §3.2; wave 0030). One table, two kinds: a `template` is a reusable layout,
 * a `report` is a document built from one or from scratch. Both carry the
 * same envelope in `body`; the row's `kind`, `name`, `status` and `starter`
 * are columns.
 *
 * NOT `scheduledReportsRepo`. That one (`adminium_scheduled_reports`, prefix
 * `rep`) is the recurring CSV snapshot of a page. This one is the report
 * BUILDER's authored source, prefix `rpt` — the two share only the English
 * word (43 §0.3 traps 1 and 7).
 *
 * `body` is the OPEN record (`reportBodySchema`); the concrete field shape is
 * owned by `apps/server/src/report-documents/document.ts` — the repo validates
 * the envelope's enums and the summary, never the body's fields, so a body a
 * newer server wrote round-trips byte-identical (the email/invoice rule).
 *
 * POSITION IS THE COMP'S ARRAY INDEX. The manager orders each kind by
 * `position` and the comp's two placements are reproduced here as arithmetic
 * on it, each inside one transaction:
 *
 *   `{ at: 'first' }`  — position = min − 1 (a new document is prepended,
 *                        comp `createFrom` 553)
 *   `{ after: id }`    — every row of that kind past the source moves +1 and
 *                        the new row takes source + 1 (a duplicate lands
 *                        directly after its source, comp `duplicate` 555)
 *
 * There is no third placement: this comp has no language variations and no
 * topics (43 §5 item 3), so no family for a row to join.
 *
 * A source that no longer exists is placed at the end rather than refused:
 * the route has already answered 404 for a missing row, so the fallback only
 * ever covers a race, and losing the document would be the worse outcome.
 */

import type { Kysely, Selectable, Transaction } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import {
  reportBodySchema,
  reportDocumentKindSchema,
  reportStatusSchema,
  reportSummarySchema,
  type ReportBodyRecord,
  type ReportDocumentKind,
  type ReportStatus,
  type ReportSummary,
} from '../schema/json-payloads.js';
import type { AdminiumReportDocumentsTable, MetaDB } from '../schema/tables.js';
import { affected, packJson, readJson } from './util.js';

export interface ReportDocument {
  id: string;
  kind: ReportDocumentKind;
  name: string;
  status: ReportStatus;
  /** Which starter minted it; null for blank documents (43 D14). */
  starter: string | null;
  /** The template a report was built from (43 D6); null otherwise. */
  originId: string | null;
  /** The manager's sort key within the kind. */
  position: number;
  body: ReportBodyRecord;
  summary: ReportSummary;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateReportDocumentInput {
  kind: ReportDocumentKind;
  name: string;
  status?: ReportStatus | undefined;
  starter?: string | null | undefined;
  originId?: string | null | undefined;
  body: ReportBodyRecord;
  summary: ReportSummary;
  createdBy?: string | null | undefined;
}

/** Everything a save or a rename may change; absent = untouched. */
export interface PatchReportDocumentInput {
  name?: string | undefined;
  status?: ReportStatus | undefined;
  body?: ReportBodyRecord | undefined;
  summary?: ReportSummary | undefined;
}

/** Where a new row lands in its kind's order — see the header. */
export type ReportPlacement = { at: 'first' } | { after: string };

export interface ListReportDocumentsFilter {
  kind?: ReportDocumentKind | undefined;
}

/** The manager's tab badges — ALWAYS unfiltered (the comp's badges never respond to the search box, 580). */
export interface ReportDocumentCounts {
  template: number;
  report: number;
}

function decode(row: Selectable<AdminiumReportDocumentsTable>): ReportDocument {
  return {
    id: row.id,
    kind: reportDocumentKindSchema.parse(row.kind),
    name: row.name,
    status: reportStatusSchema.parse(row.status),
    starter: row.starter,
    originId: row.originId,
    position: Number(row.position),
    body: reportBodySchema.parse(readJson(row.body)),
    summary: reportSummarySchema.parse(readJson(row.summary)),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

type Db = Kysely<MetaDB> | Transaction<MetaDB>;

export function reportDocumentsRepo(meta: MetaDb) {
  const { db } = meta;

  async function findById(id: string): Promise<ReportDocument | null> {
    const row = await db.selectFrom('adminium_report_documents').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? decode(row) : null;
  }

  /** `max(position) + 1` over the kind — the end of its list; 0 for an empty kind. */
  async function endOf(trx: Db, kind: ReportDocumentKind): Promise<number> {
    const row = await trx
      .selectFrom('adminium_report_documents')
      .select(({ fn }) => fn.max<number | null>('position').as('n'))
      .where('kind', '=', kind)
      .executeTakeFirst();
    return row?.n === null || row?.n === undefined ? 0 : Number(row.n) + 1;
  }

  /** Open a gap at `position + 1` within the kind by moving every later row one down. */
  async function openGapAfter(trx: Db, kind: ReportDocumentKind, position: number): Promise<number> {
    await trx
      .updateTable('adminium_report_documents')
      .set((eb) => ({ position: eb('position', '+', 1) }))
      .where('kind', '=', kind)
      .where('position', '>', position)
      .execute();
    return position + 1;
  }

  /** The position a new row of `kind` takes under `placement` — the header's arithmetic. */
  async function placeAt(trx: Db, kind: ReportDocumentKind, placement: ReportPlacement): Promise<number> {
    if ('at' in placement) {
      const row = await trx
        .selectFrom('adminium_report_documents')
        .select(({ fn }) => fn.min<number | null>('position').as('n'))
        .where('kind', '=', kind)
        .executeTakeFirst();
      return row?.n === null || row?.n === undefined ? 0 : Number(row.n) - 1;
    }
    const source = await trx
      .selectFrom('adminium_report_documents')
      .select(['kind', 'position'])
      .where('id', '=', placement.after)
      .executeTakeFirst();
    if (source === undefined || source.kind !== kind) return await endOf(trx, kind);
    return await openGapAfter(trx, kind, Number(source.position));
  }

  return {
    findById,

    /** The manager's list: one kind, or both, in the comp's array order. */
    async list(filter: ListReportDocumentsFilter = {}): Promise<ReportDocument[]> {
      let q = db.selectFrom('adminium_report_documents').selectAll();
      if (filter.kind !== undefined) q = q.where('kind', '=', reportDocumentKindSchema.parse(filter.kind));
      const rows = await q.orderBy('position', 'asc').orderBy('id', 'asc').execute();
      return rows.map(decode);
    },

    /** Tab badges — never filtered. */
    async counts(): Promise<ReportDocumentCounts> {
      const byKind = await db
        .selectFrom('adminium_report_documents')
        .select(['kind', ({ fn }) => fn.countAll<number>().as('n')])
        .groupBy('kind')
        .execute();
      const counts: ReportDocumentCounts = { template: 0, report: 0 };
      for (const row of byKind) {
        const kind = reportDocumentKindSchema.safeParse(row.kind);
        if (kind.success) counts[kind.data] = Number(row.n);
      }
      return counts;
    },

    /** A new row at `placement` (default: first), the position arithmetic and the insert in one transaction. */
    async create(
      input: CreateReportDocumentInput,
      at: number = Date.now(),
      placement: ReportPlacement = { at: 'first' },
    ): Promise<ReportDocument> {
      const kind = reportDocumentKindSchema.parse(input.kind);
      const id = newId('rpt');
      await db.transaction().execute(async (trx) => {
        const position = await placeAt(trx, kind, placement);
        await trx
          .insertInto('adminium_report_documents')
          .values({
            id,
            kind,
            name: input.name,
            status: reportStatusSchema.parse(input.status ?? 'draft'),
            starter: input.starter ?? null,
            originId: input.originId ?? null,
            position,
            body: packJson(reportBodySchema.parse(input.body)),
            summary: packJson(reportSummarySchema.parse(input.summary)),
            createdBy: input.createdBy ?? null,
            createdAt: at,
            updatedAt: at,
          })
          .execute();
      });
      const row = await findById(id);
      if (row === null) throw new Error(`report document insert lost its row: ${id}`);
      return row;
    },

    /** The explicit save and the rename; null when the row does not exist. */
    async patch(id: string, input: PatchReportDocumentInput, at: number = Date.now()): Promise<ReportDocument | null> {
      const set = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.status === undefined ? {} : { status: reportStatusSchema.parse(input.status) }),
        ...(input.body === undefined ? {} : { body: packJson(reportBodySchema.parse(input.body)) }),
        ...(input.summary === undefined ? {} : { summary: packJson(reportSummarySchema.parse(input.summary)) }),
        updatedAt: at,
      };
      const res = await db.updateTable('adminium_report_documents').set(set).where('id', '=', id).executeTakeFirst();
      if (affected(res.numUpdatedRows) === 0) return null;
      return await findById(id);
    },

    /** Hard delete — this surface has no archive (the comp's `doDelete`, 560; 43 D8). */
    async removeById(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_report_documents').where('id', '=', id).executeTakeFirst();
      return affected(res.numDeletedRows as bigint | undefined) === 1;
    },
  };
}

export type ReportDocumentsRepo = ReturnType<typeof reportDocumentsRepo>;
