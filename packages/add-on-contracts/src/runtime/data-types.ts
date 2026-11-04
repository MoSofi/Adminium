// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DATA KIT'S SIGNATURES — what `host.data` holds, as a page reads it.
 *
 * A page of an add-on that keeps tables reads and writes them through hooks
 * the host publishes, with the signed-in reader's own grants: nothing a page
 * can do here is something that reader could not do on a generated page.
 * Tables are named by the add-on's OWN short names; the host finds the real
 * table and the connection from the add-on's install.
 *
 * Types only. A host checks itself against them (`satisfies AddOnDataHooks`)
 * without importing the shim, which reads the host at module load.
 */

import type { FormSummary } from '../forms/summary.js';

/** A value as a row holds it: decimals and money are text, so no figure is rounded on the way. */
export type DataValue = string | number | boolean | null;
export type DataRow = Readonly<Record<string, DataValue>>;

/** One filter of a list: a column, how it is compared, and with what. */
export interface DataFilter {
  column: string;
  op: 'eq' | 'neq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'empty' | 'notEmpty';
  value?: DataValue | readonly DataValue[];
}

export interface DataSort {
  column: string;
  direction: 'asc' | 'desc';
}

/** A refusal as the page may show it: the server's code, its sentence, and what it says of the row. */
export interface DataError {
  code: string;
  message: string;
  details?: Readonly<Record<string, unknown>>;
}

export interface UseRecordsOptions {
  filter?: readonly DataFilter[];
  sort?: readonly DataSort[];
  page?: number;
  pageSize?: number;
  /** The columns to read; absent, every column the reader may see. */
  columns?: readonly string[];
  /** Read nothing while false (a list that waits for a choice). */
  enabled?: boolean;
}

export interface UseRecordsResult {
  rows: readonly DataRow[];
  /** Whether a later page exists. The server filters and pages; the page never holds the whole table. */
  hasMore: boolean;
  loading: boolean;
  error: DataError | null;
  refetch: () => void;
}

export interface UseRecordResult {
  row: DataRow | null;
  loading: boolean;
  error: DataError | null;
  refetch: () => void;
}

/** What a ledger said of one save: whether its answer was written, and what it told staff of the line. */
export interface PostingSaid {
  ledger: string;
  state: string;
  reason?: string;
  left?: string;
  notes?: readonly { line: number; note: string }[];
}

/** One row's outcome of a write made row by row. */
export type EachResult = { key: string; ok: true; row: DataRow; postings?: readonly PostingSaid[] } | { key: string; ok: false; error: DataError } | { key: string; ok: false; notRun: true };

/**
 * A code Adminium made that is shown once and stored nowhere it can be read
 * again (a gift card's): handed to whoever made the row, with the ticket a
 * print of it takes.
 */
export interface OnceValue {
  table: string;
  key: string;
  column: string;
  value: string;
  print: string;
}

export interface WriteResult {
  /** The row as it was saved, with every column Adminium decided. */
  row: DataRow;
  once?: readonly OnceValue[];
  /** What each ledger the save posted into said of it; absent where it posted into none. */
  postings?: readonly PostingSaid[];
}

export interface UseWriteResult {
  create: (values: Readonly<Record<string, DataValue>>) => Promise<WriteResult>;
  update: (key: string | number, values: Readonly<Record<string, DataValue>>) => Promise<WriteResult>;
  /**
   * Removes one row. `reason`: why, for a table that asks (`removal.reason` in
   * its manifest): kept in the removal's audit entry and with the removed row;
   * refused by a table that asks for none, and required where it says so.
   */
  remove: (key: string | number, options?: { reason?: string }) => Promise<void>;
  /** The same change to up to 500 rows, one save each: what a bulk change is where a save may post. */
  /** `from`: the state every row was seen in — a row that moved meanwhile is refused, never moved twice. */
  updateEach: (keys: readonly (string | number)[], values: Readonly<Record<string, DataValue>>, options?: { from?: string }) => Promise<readonly EachResult[]>;
  /** Up to 500 rows made, one save each. */
  createEach: (rows: readonly Readonly<Record<string, DataValue>>[]) => Promise<readonly EachResult[]>;
  saving: boolean;
  error: DataError | null;
}

/**
 * Reads made when something happens — a scan, a run over a sheet's lines —
 * and not while the page is drawn: the same routes and the same grants as
 * the lists, answered as a promise.
 */
export interface UseReadResult {
  list: (table: string, options?: Omit<UseRecordsOptions, 'enabled'>) => Promise<{ rows: readonly DataRow[]; hasMore: boolean }>;
  /** One row by its key; null where there is none the reader may see. */
  get: (table: string, key: string | number) => Promise<DataRow | null>;
}

/** A row with the rows that belong to it, made in one save. */
export interface TreeNode {
  values: Readonly<Record<string, DataValue>>;
  children?: Readonly<Record<string, readonly TreeNode[]>>;
}

export interface UseTreeWriteResult {
  create: (tree: TreeNode) => Promise<WriteResult>;
  /** What the save would do, with nothing written. */
  dryRun: (tree: TreeNode) => Promise<Readonly<Record<string, unknown>>>;
  saving: boolean;
  error: DataError | null;
}

/** Moves a row along its states by one of its table's declared actions: the action's id, and what its confirm asked for. */
export type UseStateMoveResult = (key: string | number, actionId: string, values?: Readonly<Record<string, DataValue>>) => Promise<WriteResult>;

export interface UseAccessResult {
  /** False until the reader's grants are known. */
  ready: boolean;
  canRead: (table: string, columns?: readonly string[]) => boolean;
  canCreate: (table: string) => boolean;
  canUpdate: (table: string) => boolean;
  /** Whether the reader may make this declared action of the table, from the state a row is in. */
  canMove: (table: string, actionId: string, from?: string) => boolean;
  /** Whether the add-on is connected to something that offers this (`has` of the kit's one read). */
  has: (feature: string) => boolean;
  /** The currency of the database the add-on's tables are in (ISO 4217); null when the owner set none. Absent on a host older than 0.3.18. */
  currency?: string | null;
}

export interface LookUpAnswer {
  kind: string;
  table: string;
  key: string;
  /** The columns the add-on's `lookUp` shows of the row. Never the code itself. */
  row: DataRow;
  rows?: readonly DataRow[];
  /** How the row was found: by the code typed, or by a customer's address. */
  by?: 'code' | 'address';
  /** The last four of the stored code, for "the card ending Q4XP"; null where there is no code to end. */
  last4?: string | null;
  /** An address only: how many further rows it matched. */
  more?: number;
}

export interface UseLookUpResult {
  /** One typed or scanned value, tried against each kind the add-on declares. Null: nothing found. */
  find: (typed: string) => Promise<LookUpAnswer | null>;
  finding: boolean;
  error: DataError | null;
}

/** What a ledger says of one row with nothing written. The staff fields are present only for a reader of the stock tables. */
export interface WordsAnswer {
  id: string;
  state: 'in' | 'low' | 'out';
  left?: string;
  exact?: string;
  after?: string;
  batch?: string;
  expires?: string;
  cause?: 'stock' | 'portions';
  first?: { item: string; unit: string };
  soon?: boolean;
}

export interface UseWordsResult {
  /** `table`: the host table's stored name; `ids`: up to 60 of its rows' keys. */
  ask: (table: string, ids: readonly (string | number)[]) => Promise<readonly WordsAnswer[]>;
}

export interface OpenDocumentOptions {
  /** Open the print dialog once it is drawn. */
  print?: boolean;
  paper?: string;
  /** The ticket of a code shown once (`OnceValue.print`). */
  once?: string;
  values?: Readonly<Record<string, DataValue>>;
  locale?: string;
}

export interface UseDocumentResult {
  open: (kind: string, table: string, key: string | number, options?: OpenDocumentOptions) => Promise<void>;
  opening: boolean;
  error: DataError | null;
}

export interface UseExportResult {
  /** Starts an export of a table's rows; answers its id. */
  start: (table: string, options: { filter?: readonly DataFilter[]; columns?: readonly string[]; format: 'csv' | 'xlsx' }) => Promise<string>;
  download: (id: string) => Promise<void>;
  running: boolean;
  error: DataError | null;
}

/**
 * A form's results, counted by the engine over every answer (a forms add-on's
 * pages): what a survey's results page shows, with no row read. `invited` and
 * `answered` count its invitations; null when the add-on keeps none.
 */
export interface FormSummaryAnswer extends FormSummary {
  invited: number | null;
  answered: number | null;
}

export interface UseFormSummaryResult {
  /** Null until it is in, and for no form. */
  summary: FormSummaryAnswer | null;
  loading: boolean;
  error: DataError | null;
  refetch: () => void;
}

/** A column of a table a form may become a row of. */
export interface FormTableColumn {
  name: string;
  label: string;
  /** Its kind (`text`, `integer`, `enum`, `date`, …). */
  kind: string;
  /** The row must have it. */
  required: boolean;
  /** A link to another row: filled only from a named survey's invitation, never from a question. */
  link: boolean;
  /** An enum's values, in order: what a choice question's ids must be to fill it (from Adminium 0.3.41). */
  values?: readonly string[];
  /** The longest text the column holds (from Adminium 0.3.41). */
  maxLength?: number;
}

/** A table an app opens to forms (its `publicAccess` entry under the key `forms`): what a form's answer may become a row of. */
export interface FormTable {
  /** The id "becomes" names it by. */
  id: string;
  tableRef: string;
  label: string;
  /** The name of the app that opens it. */
  app: string;
  /** The columns an answer may fill. */
  columns: readonly FormTableColumn[];
  /** The slug of a generated page of the table the reader may open: a row it became is at `/p/<page>/r/<key>` (from Adminium 0.3.41). */
  page?: string;
  /** The column a form's fixed "Source" value goes into, as the app names it (from Adminium 0.3.41). */
  sourceColumn?: string;
}

export interface UseFormTablesResult {
  /** Every table a form of this add-on may become a row of; empty when no app opens one. Absent from a host older than 0.3.40. */
  tables: readonly FormTable[];
}

/** A file put into a file column of one of the add-on's own rows, and the row as saved with it. */
export interface UploadResult {
  /** What the column now holds for the file: its reference, in the column's own shape. */
  ref: string;
  /** The stored file's id. */
  id: string;
  /** The file's name, as it was sent. */
  name: string;
  /** Its type, as Adminium read it from the bytes (never the browser's claim). */
  mime: string;
  /** Its size in bytes, as stored (a cleaned SVG is its cleaned size). */
  size: number;
  /**
   * An SVG is kept only cleaned: what the cleaner took out of it, by name (an
   * element as `<script>`, an attribute or a style property by its own name),
   * each once. Empty for any other file, and when nothing was taken out.
   */
  removed: readonly string[];
  /** The row as it was saved with the file in its column. */
  row: DataRow;
}

/**
 * Puts files into one file column of one of the add-on's own tables. The
 * bytes go through the dashboard's own files route, judged as a record
 * form's upload is: the reader's grant on the table, the column's file rule
 * (the kinds it takes, its size, an SVG cleaned, a font or a model read
 * whole). The row is then saved with the file in the column, through the data
 * routes and every rule of the table, which is when the file becomes the
 * row's. A refusal of either leaves no file behind.
 */
export interface UseUploadResult {
  /** Uploads `file` and saves it into the column of the row `key`. `name`: the file's name, when `file` is a Blob with none. */
  upload: (key: string | number, file: Blob, options?: { name?: string }) => Promise<UploadResult>;
  uploading: boolean;
  error: DataError | null;
}

/** The data kit's hooks, by name. */
export interface AddOnDataHooks {
  useRecords: (table: string, options?: UseRecordsOptions) => UseRecordsResult;
  useRecord: (table: string, key: string | number | null) => UseRecordResult;
  useRead: () => UseReadResult;
  useWrite: (table: string) => UseWriteResult;
  useTreeWrite: (table: string) => UseTreeWriteResult;
  useStateMove: (table: string) => UseStateMoveResult;
  useAccess: () => UseAccessResult;
  useLookUp: (addOnKey?: string) => UseLookUpResult;
  useWords: (wordsId: string) => UseWordsResult;
  useDocument: () => UseDocumentResult;
  useExport: () => UseExportResult;
  /** A form's results, counted over every answer (a forms add-on, from Adminium 0.3.40). */
  useFormSummary: (formId: string | number | null) => UseFormSummaryResult;
  /** The tables a form may become a row of (a forms add-on, from Adminium 0.3.40). */
  useFormTables: () => UseFormTablesResult;
  /** Files into a file column of one of the add-on's own tables (from Adminium 0.3.43; absent before). */
  useUpload: (table: string, column: string) => UseUploadResult;
}

/**
 * What `host.data` is: its version, the hooks above, and the components of
 * `ADD_ON_DATA_EXPORTS` — each the host's own, so a page looks and behaves
 * like the rest of the dashboard.
 */
export type AddOnDataKit = { readonly version: number } & AddOnDataHooks & Readonly<Record<string, unknown>>;
