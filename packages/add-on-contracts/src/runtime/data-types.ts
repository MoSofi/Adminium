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

/** One row's outcome of a write made row by row. */
export type EachResult = { key: string; ok: true; row: DataRow } | { key: string; ok: false; error: DataError } | { key: string; ok: false; notRun: true };

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
}

export interface UseWriteResult {
  create: (values: Readonly<Record<string, DataValue>>) => Promise<WriteResult>;
  update: (key: string | number, values: Readonly<Record<string, DataValue>>) => Promise<WriteResult>;
  remove: (key: string | number) => Promise<void>;
  /** The same change to up to 500 rows, one save each: what a bulk change is where a save may post. */
  updateEach: (keys: readonly (string | number)[], values: Readonly<Record<string, DataValue>>) => Promise<readonly EachResult[]>;
  /** Up to 500 rows made, one save each. */
  createEach: (rows: readonly Readonly<Record<string, DataValue>>[]) => Promise<readonly EachResult[]>;
  saving: boolean;
  error: DataError | null;
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

/** The data kit's hooks, by name. */
export interface AddOnDataHooks {
  useRecords: (table: string, options?: UseRecordsOptions) => UseRecordsResult;
  useRecord: (table: string, key: string | number | null) => UseRecordResult;
  useWrite: (table: string) => UseWriteResult;
  useTreeWrite: (table: string) => UseTreeWriteResult;
  useStateMove: (table: string) => UseStateMoveResult;
  useAccess: () => UseAccessResult;
  useLookUp: (addOnKey?: string) => UseLookUpResult;
  useWords: (wordsId: string) => UseWordsResult;
  useDocument: () => UseDocumentResult;
  useExport: () => UseExportResult;
}

/**
 * What `host.data` is: its version, the hooks above, and the components of
 * `ADD_ON_DATA_EXPORTS` — each the host's own, so a page looks and behaves
 * like the rest of the dashboard.
 */
export type AddOnDataKit = { readonly version: number } & AddOnDataHooks & Readonly<Record<string, unknown>>;
