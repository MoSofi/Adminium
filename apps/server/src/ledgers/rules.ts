// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN OWNER'S RULES ON A TABLE — stored, replaced, taken away, and judged.
 *
 * A posting an owner draws on one of their tables, the price rule beside it,
 * and the switch that turns either off are each one stored row a table: the
 * owner's own, apart from whatever an app's manifest stored there. Changing
 * one reads that row and writes it anew in one step of the store, so two
 * people saving at once never lose one of the two rules, and a reader never
 * finds half a rule.
 *
 * A rule is judged the same way wherever it comes from — the owner's sheet,
 * or a project's schema file read on another server: what it names must be
 * there. And the two questions a rule's keeper asks before it lets one be
 * changed: how many rows still hold something under it, and how many of its
 * saves were let through unasked and wait to be worked out.
 */
import type { DatabaseModel, TableModel } from '@adminium/engine';
import { optionalInput, postingFitIssues, type AddOnManifest, type Ledger, type LedgerAction, type Posting } from '@adminium/manifest';
import { overridesRepo, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import { postingsRuleIssue, viaPostingClash } from '../connections/column-rules-validation.js';
import type { EffectiveModel, EffectiveTable } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import { ruleDecidedColumns } from '../crud/decided-columns.js';
import { ConflictError } from '../errors.js';
import type { ResolvedLedger } from './registry.js';

type Db = Kysely<SourceDatabase>;

export type TableRuleOp = 'table.postings' | 'table.adjust' | 'table.switchedOff';

/** The ops a table's ledger rules are stored under: written by an install and by the owner's own routes, never by a save of every rule at once. */
export const LEDGER_RULE_OPS: ReadonlySet<string> = new Set<TableRuleOp>(['table.postings', 'table.adjust', 'table.switchedOff']);

/**
 * Changes the owner's row of one rule for a table: `change` is handed what is
 * stored now and answers what to store (null: nothing). Read and written in
 * one step of the store, behind the connection's own row, so of two changes
 * made at once the second sees the first. An app's row for the same table is
 * never touched. The row is written anew rather than changed in place, so
 * every reader that keeps a view by what is stored sees that it moved.
 */
export async function changeTableRule<T extends object>(
  meta: MetaDb,
  input: { connectionId: string; table: string; op: TableRuleOp; by?: string | null },
  change: (stored: T | null) => T | null | Promise<T | null>,
): Promise<T | null> {
  return meta.db.transaction().execute(async (trx) => {
    // One writer a connection at a time. SQLite's store has one writer anyway.
    const held = trx.selectFrom('adminium_connections').select('id').where('id', '=', input.connectionId);
    await (meta.dialect === 'sqlite' ? held : held.forUpdate()).execute();
    const rows = await trx
      .selectFrom('adminium_schema_overrides')
      .select(['id', 'value', 'status'])
      .where('connectionId', '=', input.connectionId)
      .where('op', '=', input.op)
      .where('tableName', '=', input.table)
      .where('origin', '=', 'user')
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute();
    const active = rows.filter((row) => row.status === 'active');
    // More than one of the owner's rows for one rule is a store nobody wrote through here: not guessed at.
    if (active.length > 1) throw new ConflictError('This table holds two stored rows of this rule. Remove one in Studio, then try again.', 'CONFLICT', { reason: 'duplicate-rule', table: input.table, op: input.op });
    const repo = overridesRepo({ ...meta, db: trx });
    const stored = active[0] === undefined ? null : ((await repo.findById(active[0].id))?.value as T | undefined) ?? null;
    const next = await change(stored);
    if (active[0] !== undefined) await trx.deleteFrom('adminium_schema_overrides').where('id', '=', active[0].id).execute();
    if (next !== null) await repo.create({ connectionId: input.connectionId, op: input.op, tableName: input.table, columnName: null, value: next as Record<string, unknown>, origin: 'user', createdBy: input.by ?? null });
    return next;
  });
}

/** Stores the owner's row of one rule for a table in place of the one there, or takes it away (`value: null`). */
export async function writeTableRule(meta: MetaDb, input: { connectionId: string; table: string; op: TableRuleOp; value: Record<string, unknown> | null; by?: string | null }): Promise<void> {
  await changeTableRule(meta, input, () => input.value);
}

/** The owner's stored row of a rule for a table, or null. */
export async function ownTableRule<T extends object>(meta: MetaDb, input: { connectionId: string; table: string; op: TableRuleOp }): Promise<T | null> {
  const rows = await overridesRepo(meta).listForConnection(input.connectionId, { status: 'active' });
  const row = rows.find((candidate) => candidate.op === input.op && candidate.tableName === input.table && candidate.origin === 'user');
  return row === undefined ? null : (row.value as T);
}

/** Where a rule's receipts are: a whole row's under its own table, a line's under the lines' table. */
export interface RuleReceipts {
  /** The ledger the rule posts into: one receipt table may serve two. */
  ledger: string;
  /** The table the rule is on, in its stored name. */
  tableRef: string;
  posting: string;
  /** The rule's rows are lines of another row (`via`). */
  lines: boolean;
}

type Where = { and: (parts: unknown[]) => unknown; (left: unknown, op: string, right: unknown): unknown };

const mine = (rule: RuleReceipts) => (eb: Where) =>
  eb.and([
    eb(sql.ref('ledger'), '=', rule.ledger),
    eb(sql.ref('posting'), '=', rule.posting),
    rule.lines ? eb(sql.ref('line_table'), '=', rule.tableRef) : eb.and([eb(sql.ref('source_table'), '=', rule.tableRef), eb(sql.ref('line_table'), '=', '')]),
  ]);

/**
 * How many rows hold something under a rule: the source rows with a round
 * that took or held and was not given back. A round is one more than the
 * rounds given back, so it is open when something was written in a round
 * later than the last one given back. Counted by the database: a busy rule's
 * open rounds are never read into memory.
 */
export async function holdingCount(db: Db, ledger: Pick<ResolvedLedger, 'receipts'>, rule: RuleReceipts): Promise<number> {
  const given = sql<number>`sum(case when ${sql.ref('phase')} = 'reverse' then 1 else 0 end)`;
  const reached = sql<number>`max(case when ${sql.ref('phase')} <> 'reverse' then ${sql.ref('round')} else 0 end)`;
  const open = db
    .selectFrom(ledger.receipts.id as never)
    .select([sql.ref('source_row').as('source_row')])
    .where(mine(rule) as never)
    .groupBy([sql.ref('source_row'), sql.ref('source_line')])
    .having(sql<boolean>`${reached} > ${given}`)
    .as('open');
  const counted = (await db
    .selectFrom(open)
    .select(sql<number>`count(distinct ${sql.ref('open.source_row')})`.as('n'))
    .executeTakeFirst()) as { n: unknown } | undefined;
  return Number(counted?.n ?? 0);
}

/** How many saves into a ledger (or of one rule) went through while the add-on could not be asked, and wait to be worked out. */
export async function unplannedCount(db: Db, ledger: Pick<ResolvedLedger, 'receipts' | 'id'>, rule?: RuleReceipts): Promise<number> {
  let query = db
    .selectFrom(ledger.receipts.id as never)
    .select(sql<number>`count(*)`.as('n'))
    .where(sql.ref('state'), '=', 'unplanned' as never)
    .where(sql.ref('ledger'), '=', ledger.id as never);
  if (rule !== undefined) query = query.where(mine(rule) as never);
  return Number(((await query.executeTakeFirst()) as { n: unknown } | undefined)?.n ?? 0);
}

const sorted = (record: Readonly<Record<string, unknown>>): [string, unknown][] => Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** What a change of a stored posting may not touch while rows hold under it: where it goes, whose rows it reads, when it fires, what it hands over. */
export function holdsChanged(before: Posting, after: Posting): boolean {
  const kept = (posting: Posting) =>
    JSON.stringify([posting.into, posting.via ?? null, posting.reserve ?? null, posting.post ?? null, posting.reverse ?? null, sorted(posting.map), sorted(posting.multipliers ?? {}), posting.heldUntil ?? null, posting.unlessSet ?? null, posting.only ?? null]);
  return kept(before) !== kept(after);
}

/** A ledger as an add-on's manifest declares it. */
export const ledgersOf = (manifest: AddOnManifest): readonly Ledger[] => (manifest.addOn.ledgers ?? []) as unknown as readonly Ledger[];

/** The inputs of an action a rule must map. */
export const requiredInputs = (action: LedgerAction): string[] =>
  Object.entries(action.inputs).flatMap(([name, type]) => (optionalInput(type) || (action.decides ?? []).some((rule) => rule.input === name) ? [] : [name]));

/** Every state a table's rule names. */
export function statesOf(table: Pick<EffectiveTable, 'states'>): string[] {
  const states = table.states;
  if (states === undefined) return [];
  const out = new Set<string>([states.initial]);
  for (const [from, moves] of Object.entries(states.moves)) {
    out.add(from);
    for (const move of moves) out.add(typeof move === 'string' ? move : String((move as { to: unknown }).to));
  }
  return [...out];
}

/** The columns of an add-on's one-row settings table, or null when it keeps none. */
function settingsOf(manifest: AddOnManifest): Set<string> | null {
  const ref = manifest.addOn.settingsTable;
  if (ref === undefined) return null;
  const table = (manifest.requiredSchema?.tables ?? []).find((candidate) => candidate.ref === ref);
  return table === undefined ? null : new Set(table.columns.map((column) => column.ref));
}

export interface PostingJudged {
  model: Pick<EffectiveModel, 'tables' | 'relations'>;
  table: EffectiveTable;
  posting: Posting;
  /** The installed add-on the rule names; null when it is not installed here. */
  manifest: AddOnManifest | null;
}

/**
 * Why a stored posting cannot run on this table as things stand here, or
 * null: what it NAMES must be there — its columns, the ledger, the action,
 * the action's inputs, a setting, the states of a move it fires on. A rule
 * that arrives by a project's file is held to this on every server that
 * reads it; one that fails is never half-run.
 */
export function storedPostingIssue({ model, table, posting, manifest }: PostingJudged): string | null {
  const stored = postingsRuleIssue({ postings: [posting] }, table as unknown as TableModel, model as unknown as DatabaseModel);
  if (stored !== null) return stored;
  if (manifest === null) return `The add-on "${posting.into.addOn}" is not installed on this connection.`;
  const ledger = ledgersOf(manifest).find((candidate) => candidate.id === posting.into.ledger);
  if (ledger === undefined) return `"${posting.into.addOn}" keeps no ledger "${posting.into.ledger}".`;
  const action = ledger.actions[posting.into.action];
  if (action === undefined) return `The ledger "${ledger.id}" has no action "${posting.into.action}".`;
  const missing = requiredInputs(action).find((input) => posting.map[input] === undefined);
  if (missing !== undefined) return `The action "${posting.into.action}" needs "${missing}", which the rule does not map.`;
  const unknown = Object.keys(posting.map).find((input) => action.inputs[input] === undefined);
  if (unknown !== undefined) return `The action "${posting.into.action}" takes no input "${unknown}".`;
  const settings = settingsOf(manifest);
  for (const [input, mapping] of [...Object.entries(posting.map), ...Object.entries(posting.multipliers ?? {})]) {
    if (typeof mapping !== 'object' || mapping === null || !('setting' in mapping)) continue;
    if (settings?.has(mapping.setting) !== true) return `"${input}" is read from the setting "${mapping.setting}", which "${posting.into.addOn}" does not keep.`;
  }
  // Two tables of lines under one parent with a rule of one name: their receipts could not be told apart, so neither runs.
  if (posting.via !== undefined) {
    const clash = viaPostingClash(
      model.tables.filter((other) => other.id === table.id || (other.postings ?? []).some((theirs) => theirs.id === posting.id && theirs.via !== undefined)).map((other) => ({ tableName: other.id, value: { postings: other.postings ?? [] } })),
      model as unknown as DatabaseModel,
    );
    if (clash !== null) return clash;
  }
  const parent = posting.via === undefined ? undefined : model.tables.find((candidate) => candidate.id === model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === posting.via)?.to.tableId);
  for (const phase of ['reserve', 'post', 'reverse'] as const) {
    const point = posting[phase]?.on;
    if (point === undefined || !('to' in point)) continue;
    // Under `via` a move is the parent's.
    const judged = parent ?? table;
    if (judged.states === undefined) return `${judged.name} keeps no states to move between: name a column and its values instead.`;
    const known = new Set(statesOf(judged));
    const stray = [...point.to, ...(point.from ?? [])].find((state) => !known.has(state));
    if (stray !== undefined) return `"${stray}" is not a state of ${judged.name}.`;
  }
  return null;
}

/**
 * Why an owner's posting cannot be KEPT on this table, or null: everything a
 * stored rule is held to ({@link storedPostingIssue}), then what a rule being
 * drawn now is held to as well — its fit with the action (a hold has an end),
 * a column an amount is decided into, a column an input may be read from, how
 * long a hold lasts.
 */
export function ownerPostingIssue(input: PostingJudged & { beside: readonly Posting[] }): string | null {
  const { model, table, posting, manifest, beside } = input;
  const twice = postingsRuleIssue({ postings: [...beside, posting] }, table as unknown as TableModel, model as unknown as DatabaseModel);
  if (twice !== null) return twice;
  const named = storedPostingIssue(input);
  if (named !== null) return named;
  const ledger = ledgersOf(manifest!).find((candidate) => candidate.id === posting.into.ledger)!;
  const action = ledger.actions[posting.into.action]!;
  const fit = postingFitIssues(posting, ledger, { timed: table.states?.timed !== undefined });
  if (fit.length > 0) return fit[0]!.message;
  const decides = decidedColumnIssue(posting, action, table);
  if (decides !== null) return decides;
  // A hold ends at a moment the row (or its parent) keeps: nothing else can be read as one.
  const until = posting.heldUntil;
  if (until !== undefined && typeof until !== 'string' && !('parent' in until)) return 'How long a hold lasts is read from a column of the row, or of the row its lines belong to.';
  // What an input is read from is the row's own to say: never a figure Adminium works out in the same save, nor a column another rule decides.
  const decidedInputs = new Set((action.decides ?? []).map((rule) => rule.input));
  const others = ruleDecidedColumns({ ...table, postings: (table.postings ?? []).filter((other) => other.id !== posting.id) }, model);
  const balances = new Set(table.columns.flatMap((column) => (column.rollup?.balance === undefined ? [] : [column.rollup.balance.column])));
  const read: [string, unknown][] = [...Object.entries(posting.map).filter(([name]) => !decidedInputs.has(name)), ...Object.entries(posting.multipliers ?? {}), ...(until === undefined ? [] : [['heldUntil', until] as [string, unknown]])];
  for (const [name, mapping] of read) {
    if (typeof mapping !== 'string') continue;
    const column = table.columns.find((candidate) => candidate.name === mapping);
    if (column === undefined) continue;
    if (column.rollup !== undefined || balances.has(mapping)) return `${table.name}.${mapping} is a total Adminium settles in the same save, so "${name}" is not read from it.`;
    if (column.copy?.follow === true) return `${table.name}.${mapping} follows another row and is settled in the same save, so "${name}" is not read from it.`;
    if (others.has(mapping)) return `${table.name}.${mapping} is decided by another rule, so "${name}" is not read from it.`;
  }
  return null;
}

/** The columns of the row a posting hands to the add-on's code, or keeps beside its rows: what it maps, multiplies by, and filters on. */
export function columnsHanded(posting: Posting): string[] {
  const out = new Set<string>();
  for (const mapping of [...Object.values(posting.map), ...Object.values(posting.multipliers ?? {})]) if (typeof mapping === 'string') out.add(mapping);
  return [...out];
}

/**
 * Why an amount an action decides cannot be written where the rule maps it,
 * or null: the column must be one nothing else writes.
 */
export function decidedColumnIssue(posting: Posting, action: LedgerAction, table: Pick<EffectiveTable, 'name' | 'columns' | 'states'>): string | null {
  for (const rule of action.decides ?? []) {
    const mapping = posting.map[rule.input];
    if (mapping === undefined) return `The action decides "${rule.input}": map it to the column the amount is written to.`;
    if (typeof mapping !== 'string') return `"${rule.input}" is decided by Adminium, so it is mapped to a column of the row and to nothing else.`;
    const column = table.columns.find((candidate) => candidate.name === mapping);
    if (column === undefined) continue;
    const what = column.isPrimaryKey
      ? 'the key of the row'
      : table.states?.column === mapping
        ? "the column the row's state is kept in"
        : column.formula !== undefined
          ? 'worked out by a formula'
          : column.sequence !== undefined
            ? 'a running number'
            : column.rollup !== undefined
              ? 'a total'
              : null;
    if (what !== null) return `"${rule.input}" is decided by Adminium and written to ${table.name}.${mapping}, which is ${what}: map it to a plain column.`;
  }
  return null;
}
