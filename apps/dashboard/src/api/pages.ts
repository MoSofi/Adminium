// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page-config client (loader contract): `GET /api/v1/pages/:pageId` → run
 * client-side config migrations (`@adminium/engine/config`, the
 * browser-safe subpath — same functions the server runs on read) →
 * Zod-validate the envelope. The migrate-and-validate step is
 * `pageDocument.ts#parsePageDocument`, a chunk of its own that `pageQuery`
 * fetches beside the document (it is zod, which the first paint never needs).
 *
 * Never-crash rules: a document with `v` newer than this build renders the
 * "config too new" card; a document failing envelope validation renders the
 * invalid-config card. Both are ordinary query *data* (`PageDocumentResult`), not
 * thrown errors — only transport/API failures (403/404/5xx) throw, so the route
 * error mapping can render the matching system state.
 */
import { queryOptions } from '@tanstack/react-query';

import type { ColumnFact, ColumnFacts } from '@adminium/widgets';

import { api } from '../app/api.js';
import type {
  BulkActionFact,
  ColumnFactsReply,
  PageDocumentResult,
  RecordTabFact,
  StateActionFact,
} from './pageFacts.js';
import { loadPageReader } from './pageReader.js';

export type { PageEnvelope } from '@adminium/engine/config';
export type { ColumnFact, ColumnFacts };
export type {
  BulkActionFact,
  FormChildFactReply,
  FormColumnFactReply,
  FormRelationFactReply,
  PageDocumentResult,
  RecordTabFact,
  StateActionFact,
} from './pageFacts.js';

/** The reply's array, keyed by column name — the shape the form reads. */
function factsByColumn(block: ColumnFactsReply | undefined): ColumnFacts {
  const facts: Record<string, ColumnFact> = {};
  for (const column of block?.columns ?? []) {
    const name = column.spec.name;
    if (typeof name !== 'string' || name === '') continue;
    facts[name] = {
      filledBy: column.filledBy,
      required: column.required,
      ...(column.requiredWhen === undefined ? {} : { requiredWhen: column.requiredWhen }),
      ...(column.mentions === true ? { mentions: true as const } : {}),
      ...(column.place === true ? { place: true as const } : {}),
      ...(column.area === true ? { area: true as const } : {}),
      writable: column.writable,
      ...(column.insertable === undefined ? {} : { insertable: column.insertable }),
      ...(column.updatable === undefined ? {} : { updatable: column.updatable }),
      // The RULE, not its answers: a named list is resolved where the reader's
      // language is known (`api/optionLists.ts`).
      ...(column.options === undefined ? {} : { options: column.options }),
      ...(column.enumLabels === undefined ? {} : { enumLabels: column.enumLabels }),
      ...(column.enumTones === undefined ? {} : { enumTones: column.enumTones }),
    };
  }
  return facts;
}


/** Page documents change on regeneration/edits, both WS-invalidated — 5 min. */
export const PAGE_STALE_TIME_MS = 5 * 60_000;

export function pageQuery(pageId: string) {
  return queryOptions({
    queryKey: ['page', pageId] as const,
    staleTime: PAGE_STALE_TIME_MS,
    queryFn: async (): Promise<PageDocumentResult> => {
      // The reader is zod, a chunk of its own (`pageDocument.ts`): fetched
      // beside the document, not after it. A failed fetch of either is a
      // transport failure, and throws like one.
      const reading = loadPageReader();
      reading.catch(() => undefined);
      const reply = await api.get<{
        data: unknown;
        revision?: number;
        canEditLayout?: boolean;
        canCreate?: boolean;
        canUpdate?: boolean;
        canDelete?: boolean;
        canAttach?: boolean;
        canUnmask?: boolean;
        stateActions?: StateActionFact[];
        bulkActions?: BulkActionFact[];
        recordTabs?: RecordTabFact[];
        columnFacts?: ColumnFactsReply;
      }>(`/api/v1/pages/${encodeURIComponent(pageId)}`);
      const result = (await reading).parsePageDocument(reply.data);
      return result.status === 'ok'
        ? {
            ...result,
            revision: typeof reply.revision === 'number' ? reply.revision : null,
            canEditLayout: reply.canEditLayout === true,
            // `!== false`: only an explicit server denial hides an affordance
            // (absent = not computed, keep the permissive default).
            canCreate: reply.canCreate !== false,
            canUpdate: reply.canUpdate !== false,
            canDelete: reply.canDelete !== false,
            canAttach: reply.canAttach !== false,
            // `=== true`: opposite polarity — absent means keep cells masked.
            canUnmask: reply.canUnmask === true,
            stateActions: reply.stateActions ?? [],
            bulkActions: reply.bulkActions ?? [],
            recordTabs: reply.recordTabs ?? [],
            columnFacts: factsByColumn(reply.columnFacts),
            formColumns: reply.columnFacts?.columns ?? [],
            formRelations: reply.columnFacts?.relations ?? [],
            formChildren: reply.columnFacts?.children ?? [],
            tableLabelSingular: reply.columnFacts?.table.labelSingular ?? null,
            tableLabelPlural: reply.columnFacts?.table.labelPlural ?? null,
            removalReason: reply.columnFacts?.table.removalReason ?? null,
          }
        : result;
    },
  });
}
