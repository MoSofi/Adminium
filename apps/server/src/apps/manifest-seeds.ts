// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ROWS AN ADD-ON STARTS WITH.
 *
 * An add-on may declare rows its tables hold from the first second: its units
 * of measure, its reasons, the one row of its settings. They are written once,
 * by its install, into a table that is EMPTY — a table that already holds a
 * row (a reinstall over tables that were kept, a table the owner filled) is
 * left exactly as it is. They are the owner's rows from then on: in no sample
 * ledger, so "Remove sample data" never takes one.
 *
 * Written the way the sample loader writes a row: checked as a create, with
 * the table's own defaults, copies, formulas, numbers and codes, and with no
 * limit judged. Nothing is posted, no hook runs, no rule is told. Every seed
 * of one install goes in one transaction: a refused row leaves none behind,
 * and the same install starts again from the top.
 *
 * Last comes the settings row: when the add-on names a settings table and it
 * is still empty after the seeds, one row of column defaults.
 */
import { MAX_SEED_ROWS, type Manifest } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { tableRulesFor } from '../crud/column-rules.js';
import { createWriteService, insertRow, type WriteContext, type WriteTarget } from '../crud/write-service.js';
import { writeStores } from '../crud/write-stores.js';
import { ValidationFailedError } from '../errors.js';
import { pickText } from './sample-data.js';

type Row = Record<string, unknown>;
type Dialect = WriteTarget['dialect'];

export interface SeedsInput {
  meta: MetaDb;
  manifest: Manifest;
  /** The manifest's short table names → the real ones. */
  names: Readonly<Record<string, string>>;
  view: SnapshotView;
  source: { db: Kysely<unknown>; dialect: Dialect };
  /** Who the rows are written by; nobody for an install no person stands behind. */
  actor: { id: string; label: string } | null;
  /** The installing person's language: a `{"@t": {…}}` text is written in it. */
  locale: string;
  /** Reads a file of the package (`seeds/units.json`), verified against what was staged. */
  readFile: (path: string) => Promise<Buffer>;
  /** An update seeds only the tables it made (by their short names); absent, every declared seed is tried. */
  only?: ReadonlySet<string> | undefined;
}

export interface SeedsResult {
  /** Rows written, by the manifest's short table name. */
  written: Record<string, number>;
  /** Tables that already held a row and were left alone. */
  kept: string[];
  /** The settings row: made now, already there, or the add-on names no settings table. */
  settings: 'made' | 'kept' | null;
}

const refused = (table: string, issues: unknown, message = `A starting row for "${table}" was refused.`): ValidationFailedError =>
  new ValidationFailedError(message, { reason: 'SEED_ROW_REFUSED', table, issues });

/** The rows of one entry: its own, or its file's — which no validator has read, so it is read as strictly here. */
async function rowsOf(seed: { table: string; rows?: Row[] | undefined; file?: string | undefined }, readFile: SeedsInput['readFile']): Promise<Row[]> {
  if (seed.rows !== undefined) return seed.rows;
  const file = seed.file as string;
  let parsed: unknown;
  try {
    parsed = JSON.parse((await readFile(file)).toString('utf8'));
  } catch {
    throw refused(seed.table, [{ message: `"${file}" is not there, or is not JSON` }], `The starting rows of "${seed.table}" could not be read.`);
  }
  const plain = (row: unknown): row is Row => typeof row === 'object' && row !== null && !Array.isArray(row);
  if (!Array.isArray(parsed) || !parsed.every(plain) || parsed.length > MAX_SEED_ROWS) {
    throw refused(seed.table, [{ message: `"${file}" is a list of at most ${String(MAX_SEED_ROWS)} rows` }], `The starting rows of "${seed.table}" could not be read.`);
  }
  return parsed;
}

/**
 * One row's values: a text in the installer's language, an earlier row's key,
 * anything else as written. Null for a row that points at one left out (its
 * table already held rows, so the row it names was never written): it goes too.
 */
function valuesOf(table: string, row: Row, labels: ReadonlyMap<string, unknown>, leftOut: ReadonlySet<string>, locale: string): Row | null {
  const out: Row = {};
  for (const [column, value] of Object.entries(row)) {
    if (column === '@label') continue;
    if (column.startsWith('@')) throw refused(table, [{ column, message: 'a starting row takes "@label" and no other row directive' }]);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      out[column] = value;
      continue;
    }
    const record = value as Row;
    const texts = record['@t'];
    const named = record['@ref'];
    if (typeof texts === 'object' && texts !== null && !Array.isArray(texts)) out[column] = pickText(texts as Record<string, string>, locale);
    else if (typeof named === 'string') {
      if (leftOut.has(named)) return null;
      if (!labels.has(named)) throw refused(table, [{ column }], `A starting row for "${table}" points at "${named}", and no starting row before it carries that label.`);
      out[column] = labels.get(named);
    } else if (Object.keys(record).some((key) => key.startsWith('@'))) {
      throw refused(table, [{ column, message: 'a starting value is a plain value, {"@t": {…}} or {"@ref": "<label>"}' }]);
    } else out[column] = value;
  }
  return out;
}

const holdsARow = async (db: Kysely<unknown>, table: ResolvedTable): Promise<boolean> => (await sql`select 1 as one from ${sql.table(table.id)} limit 1`.execute(db)).rows.length > 0;

export async function writeManifestSeeds(input: SeedsInput): Promise<SeedsResult> {
  const { manifest, view, source } = input;
  const result: SeedsResult = { written: {}, kept: [], settings: null };
  const settingsRef = manifest.kind === 'add-on' ? manifest.addOn.settingsTable : undefined;
  const seeds = (manifest.seeds ?? []).filter((seed) => input.only === undefined || input.only.has(seed.table));
  if (seeds.length === 0 && settingsRef === undefined) return result;

  const tableOf = (ref: string): ResolvedTable => view.table(input.names[ref] ?? ref);

  // Every read that decides what is written happens before the transaction opens: with a pool of one there is no second handle.
  const todo: { ref: string; table: ResolvedTable; rows: Row[] }[] = [];
  const emptyBefore = new Map<string, boolean>();
  /** The labels of rows that are not written: what points at one is left out with it. */
  const leftOut = new Set<string>();
  for (const seed of seeds) {
    const table = tableOf(seed.table);
    if (!emptyBefore.has(seed.table)) emptyBefore.set(seed.table, !(await holdsARow(source.db, table)));
    const rows = await rowsOf(seed, input.readFile);
    if (emptyBefore.get(seed.table) !== true) {
      if (!result.kept.includes(seed.table)) result.kept.push(seed.table);
      for (const row of rows) if (typeof row['@label'] === 'string') leftOut.add(row['@label']);
      continue;
    }
    todo.push({ ref: seed.table, table, rows });
  }
  const settingsTable = settingsRef === undefined ? null : tableOf(settingsRef);
  const settingsSeeded = settingsRef !== undefined && todo.some((entry) => entry.ref === settingsRef && entry.rows.length > 0);
  const settingsEmpty = settingsTable !== null && !settingsSeeded && !(await holdsARow(source.db, settingsTable));
  if (settingsTable !== null) result.settings = settingsEmpty || settingsSeeded ? 'made' : 'kept';
  if (result.settings === 'kept' && !result.kept.includes(settingsRef as string)) result.kept.push(settingsRef as string);
  if (todo.length === 0 && !settingsEmpty) return result;

  const writes = createWriteService(writeStores(input.meta));
  const context: WriteContext = { origin: 'import', hops: 0, actor: input.actor === null ? null : { kind: 'user', id: input.actor.id, label: input.actor.label }, request: null };

  await (source.db as Kysely<Record<string, never>>).transaction().execute(async (trx) => {
    const db = trx as unknown as WriteTarget['db'];
    const labels = new Map<string, unknown>();
    /** The rows of tables whose totals other rows feed: settled once, when every row is in. */
    const totals = new Map<string, { target: WriteTarget; rows: { record: Row; before: null }[] }>();
    const write = async (ref: string, table: ResolvedTable, row: Row): Promise<void> => {
      const target: WriteTarget = { connectionId: view.connectionId, view, table, db, dialect: source.dialect };
      const label = row['@label'];
      const values = valuesOf(ref, row, labels, leftOut, input.locale);
      if (values === null) {
        if (typeof label === 'string') leftOut.add(label);
        return;
      }
      const checked = await writes.check('create', target, context, [values], { capacity: 'unchecked' });
      const good = checked.rows[0];
      if (good === null || good === undefined) throw refused(ref, checked.issues[0]);
      const stored = await insertRow(db, source.dialect, table, good);
      if (typeof label === 'string') {
        labels.set(label, table.primaryKey.length === 1 ? stored[table.primaryKey[0]!] : Object.fromEntries(table.primaryKey.map((column) => [column, stored[column]])));
      }
      if ((tableRulesFor({ view, table })?.ownRollups?.length ?? 0) > 0) {
        const bucket = totals.get(ref) ?? { target, rows: [] };
        bucket.rows.push({ record: stored, before: null });
        totals.set(ref, bucket);
      }
      result.written[ref] = (result.written[ref] ?? 0) + 1;
    };
    for (const entry of todo) for (const row of entry.rows) await write(entry.ref, entry.table, row);
    // The one settings row, of defaults: only when nothing above, and nobody before, gave the table one.
    if (settingsEmpty && settingsTable !== null) await write(settingsRef as string, settingsTable, {});
    for (const { target, rows } of totals.values()) await writes.settle('create', target, rows);
  });
  return result;
}
