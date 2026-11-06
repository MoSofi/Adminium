// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SELF-MADE APP'S PAGE AS A PERSON ARRANGED IT, MADE ON THE TARGET.
 *
 * A page saved from a dashboard carries its `envelope`: the body the person
 * arranged, without what only the source knew. The install makes it the
 * target's own:
 *
 *  1. The document is brought to this build's version (`runConfigMigrations`).
 *     One saved by a newer Adminium is refused, never read as this one.
 *  2. Every table it names is the app's ref, turned into the target's table
 *     through the one walk over the places a page holds a table
 *     (`envelope-refs.ts`). A ref the app does not declare is refused; nothing
 *     is passed through. A form's relation fields are bound by `bindForm`.
 *  3. A column keeps only what the person chose — its place, width, label,
 *     whether it is hidden, how it shows — and takes what it IS (type, empty
 *     or not, meaning, link) from the page the template composes on the
 *     target.
 *  4. The page's id, table, grants and address are the target's, made as a
 *     composed page gets them; the document is then checked by the engine's
 *     own schema. The caller stamps it, so an update can tell a page nobody
 *     edited from one somebody did.
 *
 * The same reads run on the plan, before anything is made
 * (`envelopePlanProblems`): a newer version, an id of the source's install,
 * a table the app does not declare. A shared view is judged the same way.
 */
import { classifyTableColumns, columnSpecsForTable, type DatabaseModel } from '@adminium/engine';
import {
  ConfigMigrationError,
  crudDetailConfigSchema,
  gridColumnSpecSchema,
  pageEnvelopeSchema,
  runConfigMigrations,
} from '@adminium/engine/config';
import { keptFromStaff, type Manifest } from '@adminium/manifest';

import { bindForm } from './manifest-page-config.js';
import { resolveTableRefs, tableRefsOf, type RefTarget, type TargetTable } from './envelope-refs.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { findInstanceIds } from '../project/instance-ids.js';
import { viewConfigSchema } from '../routes/views/schema.js';

type ManifestPage = NonNullable<Extract<Manifest, { kind: 'app' }>['pages']>[number];
type Doc = Record<string, unknown>;

/** What a person chooses about a column; the rest is the target's to say. */
export const CHOSEN_COLUMN_FIELDS = ['label', 'labels', 'hidden', 'display', 'width'] as const;

function isDoc(value: unknown): value is Doc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The tables a file may name: the app's own, and none it leaves out of Adminium. */
export function appTableRefs(manifest: Manifest): Set<string> {
  if (manifest.kind !== 'app') return new Set();
  return new Set((manifest.requiredSchema?.tables ?? []).filter((table) => (table as { exclude?: true }).exclude !== true).map((table) => table.ref));
}

/** The target's table for an app's ref: by the real name the install gave it, as the page writer finds its own table. */
export function targetTableFor(model: DatabaseModel, names: Readonly<Record<string, string>>, known: ReadonlySet<string>, ref: string): TargetTable | null {
  if (!known.has(ref)) return null;
  const real = names[ref] ?? ref;
  const table = model.tables.find((candidate) => candidate.name === real);
  return table === undefined ? null : { id: table.id, name: table.name, schema: table.schema };
}

/** A document brought to this build's version, or why it cannot be. */
function migrated(document: Doc, what: string): { document: Doc } | { problem: string } {
  try {
    return { document: runConfigMigrations(document) as Doc };
  } catch (error) {
    if (error instanceof ConfigMigrationError) return { problem: `${what} cannot be read by this Adminium: ${error.message}` };
    throw error;
  }
}

/** What is wrong with a page's envelope and views, read from the file alone. Empty when nothing is. */
export function envelopePlanProblems(manifest: Manifest): { page: string; message: string }[] {
  if (manifest.kind !== 'app') return [];
  const known = appTableRefs(manifest);
  const out: { page: string; message: string }[] = [];
  for (const page of manifest.pages ?? []) {
    const say = (message: string) => out.push({ page: page.ref, message: `The page "${page.ref}": ${message}.` });
    if (page.envelope !== undefined) {
      const read = migrated({ ...page.envelope }, 'its envelope');
      if ('problem' in read) say(read.problem);
      for (const finding of findInstanceIds(page.envelope.config)) say(`config.${finding.path}: ${finding.message}`);
      for (const { ref, where } of tableRefsOf({ config: page.envelope.config })) {
        if (!known.has(ref)) say(`${where} names "${ref}", which is not a table of this app`);
      }
    }
    for (const view of page.views ?? []) {
      const read = migrated({ ...view.config, v: view.v }, `its view "${view.name}"`);
      if ('problem' in read) say(read.problem);
      for (const finding of findInstanceIds(view.config)) say(`the view "${view.name}", ${finding.path}: ${finding.message}`);
      if (view.kind === 'filters' && !viewConfigSchema.safeParse({ ...view.config, v: 1 }).success) say(`the view "${view.name}" is not a list's saved view`);
      if (view.kind === 'layout') {
        for (const { ref, where } of tableRefsOf({ config: { layout: view.config } })) {
          if (!known.has(ref)) say(`the view "${view.name}", ${where.replace(/^config\.layout\./, '')} names "${ref}", which is not a table of this app`);
        }
      }
    }
  }
  return out;
}

export interface EnvelopeInput {
  page: ManifestPage;
  manifest: Manifest;
  /**
   * The page as the template composes it on the target — or, where nothing
   * composes, the frame of a page made by hand: the id, table, grants and
   * address are taken from it, and a list's column facts.
   */
  frame: Doc;
  connectionId: string;
  model: DatabaseModel;
  view: SnapshotView;
  /** The page's own table on the target, for a page bound to one. */
  tableId: string | null;
  names: Readonly<Record<string, string>>;
}

/** Columns the target's table does not have, dropped and said. */
export interface EnvelopeResult {
  envelope: Doc;
  warnings: string[];
}

/** The file's envelope made the target's own (unstamped), or why it cannot be. */
export function envelopeFromFile(input: EnvelopeInput): EnvelopeResult | { problem: string } {
  const file = input.page.envelope;
  if (file === undefined) return { problem: 'the page carries no envelope' };
  const read = migrated({ ...file }, 'its envelope');
  if ('problem' in read) return read;
  const ids = findInstanceIds(read.document['config']);
  if (ids.length > 0) return { problem: `config.${ids[0]!.path}: ${ids[0]!.message}` };

  const known = appTableRefs(input.manifest);
  const target: RefTarget = {
    connectionId: input.connectionId,
    postgres: input.model.dialect === 'postgres',
    table: (ref) => targetTableFor(input.model, input.names, known, ref),
  };
  const resolved = resolveTableRefs({ config: read.document['config'] }, target);
  if (resolved.problems.length > 0) return { problem: resolved.problems[0]! };
  const { generatedHash: _stamp, ...config } = (resolved.document as { config: Doc }).config;

  const warnings: string[] = [];
  const own = input.tableId === null ? null : input.view.table(input.tableId);
  // A form's relation fields name the table at their other end: bound against the target's relations.
  if (config['form'] !== undefined) {
    if (own === null) return { problem: 'its form belongs to no table' };
    const bound = bindForm(config['form'], input.view, own, input.names);
    if ('problem' in bound) return { problem: bound.problem };
    config['form'] = bound.form;
  }

  const composed = isDoc(input.frame['config']) ? input.frame['config'] : {};
  if (Array.isArray(config['columns'])) {
    const columns = mergedColumns(config['columns'], composed['columns'], input, warnings);
    if ('problem' in columns) return columns;
    config['columns'] = columns.columns;
  }
  // What the target's table is says whether the list can be written: not a file's to say.
  if ('readOnly' in composed) config['readOnly'] = composed['readOnly'];

  const envelope: Doc = {
    ...input.frame,
    ...(file.padding === undefined ? {} : { padding: file.padding }),
    ...(file.width === undefined ? {} : { width: file.width }),
    config: { ...composed, ...config },
  };
  const parsed = pageEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { problem: `${issue.path.join('.')}: ${issue.message}` };
  }
  const body = envelope['config'] as Doc;
  if (body['detail'] !== undefined && !crudDetailConfigSchema.safeParse(body['detail']).success) return { problem: 'its related tabs (config.detail) are not ones a page can show' };
  return { envelope, warnings };
}

/** Each file column on the target: its facts from the composed page, or from the table; only the chosen fields from the file. */
function mergedColumns(fileColumns: unknown[], composedColumns: unknown, input: EnvelopeInput, warnings: string[]): { columns: Doc[] } | { problem: string } {
  const composed = new Map((Array.isArray(composedColumns) ? composedColumns : []).filter(isDoc).map((column) => [String(column['name']), column]));
  const table = input.tableId === null ? undefined : input.model.tables.find((candidate) => candidate.id === input.tableId);
  // Every column of the table as a list would show it, for one the composed page left off (its list shows eight).
  let all: Map<string, Doc> | null = null;
  const secret = new Set<string>();
  const declared = input.manifest.kind === 'app' ? (input.manifest.requiredSchema?.tables ?? []).find((candidate) => table !== undefined && (input.names[candidate.ref] ?? candidate.ref) === table.name) : undefined;
  const out: Doc[] = [];
  for (const column of fileColumns) {
    if (!isDoc(column) || typeof column['name'] !== 'string') return { problem: 'a column of its list has no name' };
    const name = column['name'];
    const chosen = Object.fromEntries(CHOSEN_COLUMN_FIELDS.filter((field) => column[field] !== undefined).map((field) => [field, column[field]]));
    // A value read through a link, counted from another table, or worked out on the page: none is a column of the table.
    if (column['lookup'] !== undefined || column['reverse'] !== undefined || column['derived'] !== undefined) {
      out.push(column);
      continue;
    }
    if (declared !== undefined && keptFromStaff(declared, name) !== null) {
      warnings.push(`the column "${name}" is never on a list (${String(keptFromStaff(declared, name))}), so it was left off`);
      continue;
    }
    let base = composed.get(name);
    if (base === undefined && table !== undefined) {
      if (all === null) {
        all = new Map(columnSpecsForTable(input.model, table).map((spec) => [spec.name, spec as Doc]));
        for (const classified of classifyTableColumns(input.model, table)) if (classified.semantics.flags.secret) secret.add(classified.column);
      }
      base = secret.has(name) ? undefined : all.get(name);
    }
    if (base === undefined) {
      warnings.push(`"${name}" is not a column this page can show here, so it was left off`);
      continue;
    }
    const merged = { ...base, ...chosen };
    if (!gridColumnSpecSchema.safeParse(merged).success) return { problem: `its column "${name}" is not one a list can show` };
    out.push(merged);
  }
  return { columns: out };
}
