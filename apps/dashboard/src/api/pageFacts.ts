// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What `GET /api/v1/pages/:pageId` says beside the document, and the shape a
 * page document is read into (`PageDocumentResult`). Types only: they are
 * shared by `pages.ts` (the query, on the first paint) and `pageDocument.ts`
 * (the reader, a chunk of its own), which must not import each other.
 * `pages.ts` re-exports every one of them.
 */
import type { PageEnvelope } from '@adminium/engine/config';
import type { ColumnFacts } from '@adminium/widgets';

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

export interface ColumnFactsReply {
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
