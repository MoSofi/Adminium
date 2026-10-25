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
import type { PageEnvelope } from '@adminium/engine/config';

import type { ColumnFact, ColumnFacts } from '@adminium/widgets';

import { api } from '../app/api.js';
import { loadPageReader } from './pageReader.js';

export type { PageEnvelope } from '@adminium/engine/config';
export type { ColumnFact, ColumnFacts };

/** The `columnFacts` block as the page route sends it. */
/** Mirrors `RelationFact` on the page reply. */
export interface FormRelationFactReply {
  relationId: string;
  label: string;
  targetTable: string;
  targetKey: string;
  /** The column a chip shows; absent ⇒ the key labels itself. */
  targetName?: string;
  targetLabel?: string;
}

interface ColumnFactsReply {
  /** `labelPlural` is absent from a server older than it. */
  table: {
    labelSingular: string | null;
    labelPlural?: string | null | undefined;
    /** Whether a removal asks why (`table.removal.reason`); absent from a server older than it, and for a table that does not ask. */
    removalReason?: 'optional' | 'required' | undefined;
  };
  columns: FormColumnFactReply[];
  relations?: FormRelationFactReply[];
  children?: FormChildFactReply[];
}

/**
 * One column of that block, WHOLE — the spec included.
 *
 * The keyed `ColumnFacts` record below answers "what does the server say about
 * this column", which is all the old form needed because it rendered
 * `config.columns[]`. The form DOCUMENT needs the other half: the columns
 * themselves, in table order, including the ones the grid's eight-column cap
 * never listed. A form that can only offer what the grid shows cannot set them.
 */
/** A table whose rows this one can hold a list of — an invoice's lines. */
export interface FormChildFactReply {
  relationId: string;
  label: string;
  childTable: string;
  foreignColumn: string;
  columns: FormColumnFactReply[];
}

export interface FormColumnFactReply {
  spec: { name?: unknown } & Record<string, unknown>;
  ordinal?: number;
  filledBy: 'database' | 'adminium' | null;
  required: boolean;
  /** Asked for only while another column of the record holds one of `in`. */
  requiredWhen?: { column: string; in: (string | number | boolean)[] } | undefined;
  writable: boolean;
  /** As the connection's role is granted; absent when the server does not know. */
  insertable?: boolean | undefined;
  updatable?: boolean | undefined;
  /** Inline values carry their words in the reader's language. */
  options?: { list: string } | { values: { value: string; label?: string; tone?: string }[] } | undefined;
  validation?: Record<string, unknown> | undefined;
  /** A choice column's words for its values, in the reader's language, and their tones. */
  enumLabels?: Record<string, string> | undefined;
  enumTones?: Record<string, string> | undefined;
  /** People are mentioned in this text. */
  mentions?: true | undefined;
  /** The column holds a position on the map (`{ lat, lng, by }`), or an area (a GeoJSON polygon). */
  place?: true | undefined;
  area?: true | undefined;
}

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

/** One button of a record page, as the server offers it to one reader (`GET /pages/:id` · `stateActions`). */
export interface StateActionFact {
  id: string;
  kind: 'move' | 'set' | 'link' | 'child';
  /** In the reader's language. */
  label: string;
  tone: 'primary' | 'neutral' | 'danger';
  confirm?: string;
  /** The states of the row it may be used in. */
  from: string[];
  /** What a move or a set asks for before it is made. */
  ask?: { column: string; label: string; required: boolean }[];
  /** A link: the record's key is appended. */
  href?: string;
  /** A child form: the child table's id, its link to this row, the columns it asks for. */
  child?: { table: string; via: string; form: string[] };
  /** A child form's fixed values. */
  set?: Record<string, string | number | boolean>;
  /** Staff columns of the row: not shown to the person the row names in one of them (the save refuses it anyway). */
  notBy?: string[];
  /** A staff column of the row: shown only to the person the row names there. */
  by?: string;
}

/** One bulk action of a list, as the server offers it to one reader (`GET /pages/:id` · `bulkActions`). */
export interface BulkActionFact {
  id: string;
  label: string;
  /** The row made for each ticked row: the child table's id, its link back, the columns its form asks for once. */
  child: { table: string; via: string; form: string[] };
  set?: Record<string, string | number | boolean>;
  /** Only the ticked rows that hold this value get one. */
  where?: { column: string; eq: string | number | boolean };
  confirm: { title: string; body: string; columns: string[] };
  done: string;
}

/** One tab of an add-on's rows on a record page, as the server offers it to one reader (`GET /pages/:id` · `recordTabs`). */
export interface RecordTabFact {
  addOn: string;
  id: string;
  /** The add-on's English words for the tab, and its key for them in the add-on's own strings. */
  label: string;
  labelKey: string;
  /** The add-on's table the rows are of. */
  tableId: string;
  /** That table's key column. */
  key: string;
  /** The two columns a row is found by, and the stored name of the page's own table. */
  match: { table: string; row: string; tableRef: string };
  mode: 'list' | 'form';
  columns: FormColumnFactReply[];
  edit: string[];
  form: string[];
  add: { fk: string; table: string; key: string; label: string }[];
  remove: boolean;
  actions: { id: string; label: string; labelKey: string; tableId: string; form: FormColumnFactReply[]; can: boolean }[];
  empty: string | null;
  emptyKey: string | null;
  summary: { words: string } | null;
  can: { read: true; create: boolean; update: boolean; delete: boolean };
}

export type PageDocumentResult =
  | {
      status: 'ok';
      page: PageEnvelope;
      /** The stored document's revision as read; null from a server that does not say. */
      revision: number | null;
      canEditLayout: boolean;
      /** Per-caller write capabilities for the envelope's source table (the
       *  same `table:` grants the data routes enforce) — false hides the
       *  matching affordance so a viewer never sees a button that 403s. */
      canCreate: boolean;
      canUpdate: boolean;
      canDelete: boolean;
      /** May attach a sidecar file. Not derived from `canUpdate`: on a
       * read-only source the record cannot be edited and a file still can be
       * attached, which is what the sidecar mode is for. */
      canAttach: boolean;
      /** Caller holds the server's PII unmask permission — PII cells render a
       *  reveal affordance. Defaults CLOSED (false) when absent: the reveal is
       *  only honest when the server actually sent values in clear. */
      canUnmask: boolean;
      /**
       * The buttons a record of the source table may show this reader
       * (`states.actions`), each with the states of the row it is offered in.
       * The server decided them; empty when it computed none.
       */
      stateActions: readonly StateActionFact[];
      /** The list's own bulk actions this reader may run (`config.bulk`); empty when the page has none. */
      bulkActions: readonly BulkActionFact[];
      /** The tabs of add-ons' rows a record of the source table has, for this reader (`addOn.recordTabs`); empty when it has none. */
      recordTabs: readonly RecordTabFact[];
      /**
       * The source table as it stands right now — who fills each column and
       * which ones the create form has to ask for. Empty when the server did
       * not compute them (no source table, no snapshot, an older server), and
       * the form then falls back to the stored spec, exactly as before.
       *
       * Why not the stored `config.columns[]`: that list froze the day the
       * page was generated, regeneration will not touch a page anybody has
       * edited, and it is capped at eight columns — so a column added since
       * is invisible to the form, and a NOT NULL column added since makes
       * every create fail with no way for the form to say why.
       */
      columnFacts: ColumnFacts;
      /**
       * The same block unkeyed and whole, in table order: what the form
       * document is derived from and rendered against.
       */
      formColumns: readonly FormColumnFactReply[];
      /** The link relations this table can write through, as fields of chips. */
      formRelations: readonly FormRelationFactReply[];
      formChildren: readonly FormChildFactReply[];
      /** The table's own singular label, for the dialog's title. */
      tableLabelSingular: string | null;
      /** What a person calls the table as a whole ("Categories"), where it has a name. */
      tableLabelPlural: string | null;
      /** Whether a removal of one of its rows asks why: the delete dialogs ask too. */
      removalReason: 'optional' | 'required' | null;
    }
  | { status: 'too-new'; v: number; latest: number }
  | { status: 'invalid'; issues: string[] };

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
