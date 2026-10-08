// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The rule that makes a table of an app post into an add-on's ledger,
 * written from the add-on's own manifest.
 *
 * A posting names the ledger's action, each of the action's inputs, and for
 * a link input the add-on's table the linked row is in. The install checks
 * every one of those names against the add-on it runs on and refuses a
 * difference. They are in the add-on's manifest and nowhere else, so this
 * reads them there: it adds the columns the action needs to the app's table,
 * writes the rule with the add-on's own input names, and says what the app
 * must name (the add-on) and may read (the tables a person picks a row of).
 *
 * What is the app's own is left to its author: the table itself, its link to
 * the row its lines belong to, the pages and the role's grants on it.
 *
 * Pure: no I/O. The caller reads the files and writes them.
 */
import { linkInputTable, optionalInput, postingPointSchema, type Ledger, type LedgerAction, type Posting, type PostingPoint } from '@adminium/manifest';

type Json = Record<string, unknown>;

/** An add-on's ledgers as its manifest declares them; none when the document is not an add-on's or keeps no ledger. */
export function declaredLedgers(document: unknown): Ledger[] {
  const ledgers = (document as { addOn?: { ledgers?: unknown } } | null)?.addOn?.ledgers;
  return Array.isArray(ledgers) ? (ledgers as Ledger[]) : [];
}

/** A table's primary-key column, by the add-on's own manifest. */
export const keyColumnOf =
  (document: unknown) =>
  (table: string): string | undefined => {
    const tables = (document as { requiredSchema?: { tables?: { ref?: unknown; columns?: { ref?: unknown; role?: unknown }[] }[] } } | null)?.requiredSchema?.tables ?? [];
    const found = tables.find((candidate) => candidate.ref === table)?.columns?.find((column) => column.role === 'pk')?.ref;
    return typeof found === 'string' ? found : undefined;
  };

/**
 * The actions of a ledger an app's rows post into: the ones that take the
 * row itself (`rowRef`), and the ones the add-on answers "is there enough?"
 * for. The rest are the add-on's own documents (a receipt, a count). A ledger
 * that marks none so is given whole.
 */
export function hostActions(document: unknown, ledger: Ledger): string[] {
  const asked = new Set(
    ((document as { addOn?: { words?: { ledger?: unknown; action?: unknown }[] } } | null)?.addOn?.words ?? []).flatMap((words) => (words.ledger === ledger.id && typeof words.action === 'string' ? [words.action] : [])),
  );
  const all = Object.keys(ledger.actions);
  const host = all.filter((name) => asked.has(name) || Object.values(ledger.actions[name]!.inputs).includes('rowRef'));
  return host.length === 0 ? all : host;
}


export interface LedgerPartsInput {
  /** The add-on's key and its manifest document. */
  addOn: string;
  document: unknown;
  ledger: string;
  action: string;
  /** The app's table, as its part file reads now. */
  table: Json;
  /** The column of this table that links a line to the row it belongs to. */
  via?: string | undefined;
  /** The moment each phase fires. */
  when: { reserve?: unknown; post?: unknown; reverse?: unknown };
  /** An input's name → a column the table already has. `heldUntil` names the column a hold lasts until. */
  columns?: Readonly<Record<string, string>> | undefined;
  /** `suggests`: the app runs without the add-on, and the rule is live only while it is there. */
  need?: 'requires' | 'suggests' | undefined;
}

export type LedgerPartsResult =
  | { ok: false; problem: string }
  | {
      ok: true;
      /** The table's file with the columns and the rule in place. */
      table: Json;
      /** The columns added, or given their link. */
      added: { column: string; type: string; links?: string }[];
      posting: Posting;
      addOn: { key: string; name: string; range: string };
      /** With `suggests`: the feature the rule is live under. */
      feature: string | null;
      /** The add-on's tables a person picks a row of, and the columns that say which row it is. */
      grants: { table: string; readable: string[] }[];
    };

const NUMERIC = new Set(['int', 'bigint', 'decimal', 'float', 'money']);
const WHOLE = new Set(['int', 'bigint']);
const MOMENT = new Set(['timestamptz', 'date']);
const PHASES = ['reserve', 'post', 'reverse'] as const;

const columnsOf = (table: Json): Json[] => (Array.isArray(table['columns']) ? (table['columns'] as Json[]) : []);
const refOf = (column: Json): string => (typeof column['ref'] === 'string' ? column['ref'] : '');

/** An action's inputs in words, as a refusal lists them: `item, quantity, place (optional)`. */
export function inputsInWords(action: Pick<LedgerAction, 'inputs'>): string {
  return Object.entries(action.inputs)
    .map(([name, type]) => (optionalInput(type) ? `${name} (optional)` : name))
    .join(', ');
}

/** The add-on tables' columns that say which row a person is picking: its label column, and any text column no two rows share. */
function pickColumns(document: unknown, table: string): string[] {
  const tables = (document as { requiredSchema?: { tables?: { ref?: unknown; keyField?: unknown; columns?: { ref?: unknown; type?: unknown; unique?: unknown }[] }[] } } | null)?.requiredSchema?.tables ?? [];
  const found = tables.find((candidate) => candidate.ref === table);
  if (found === undefined) return [];
  const out = new Set<string>();
  if (typeof found.keyField === 'string') out.add(found.keyField);
  for (const column of found.columns ?? []) if (column.type === 'text' && column.unique === true && typeof column.ref === 'string') out.add(column.ref);
  return [...out];
}

/** The inputs of an action a rule must map: every one that is not optional. */
const neededInputs = (action: Pick<LedgerAction, 'inputs'>): string[] => Object.entries(action.inputs).flatMap(([name, type]) => (optionalInput(type) ? [] : [name]));

/**
 * Why a rule an app wrote does not fit the add-on it posts into, or null:
 * the ledger and the action are the add-on's, every input it maps is one of
 * the action's, every needed one is mapped, a step it fires is one the action
 * has, and a hold has an end. Said as what to do next, for a model that
 * wrote the rule by hand.
 */
export function hostPostingIssue(posting: Posting, document: unknown): string | null {
  const again = 'Call post_to_ledger for this table again; do not edit the rule by hand.';
  const ledgers = declaredLedgers(document);
  const ledger = ledgers.find((candidate) => candidate.id === posting.into.ledger);
  if (ledger === undefined) return `${posting.into.addOn} has no ledger "${posting.into.ledger}". Its ledgers: ${ledgers.map((candidate) => candidate.id).join(', ') || 'none'}. ${again}`;
  const action = ledger.actions[posting.into.action];
  const into = `${posting.into.addOn}/${ledger.id}/${posting.into.action}`;
  if (action === undefined) return `${posting.into.addOn}/${ledger.id} has no action "${posting.into.action}". Its actions for an app's rows: ${hostActions(document, ledger).join(', ')}. ${again}`;
  const stray = Object.keys(posting.map).find((name) => action.inputs[name] === undefined);
  if (stray !== undefined) return `"${stray}" is not an input of ${into}. Its inputs are ${inputsInWords(action)}. ${again}`;
  const missing = neededInputs(action).find((name) => posting.map[name] === undefined);
  if (missing !== undefined) return `"${missing}" is not mapped. ${into} needs: ${neededInputs(action).join(', ')}. ${again}`;
  const phase = PHASES.find((candidate) => posting[candidate] !== undefined && !action.phases.includes(candidate));
  if (phase !== undefined) return `${into} has no "${phase}". It takes: ${action.phases.join(', ')}. ${again}`;
  if (action.holds === true && posting.reserve !== undefined && posting.heldUntil === undefined) return `${into} holds until a time, and the rule gives none. ${again.replace('again;', 'again with "heldUntil" in "columns";')}`;
  return null;
}

export function ledgerParts(input: LedgerPartsInput): LedgerPartsResult {
  const no = (problem: string): LedgerPartsResult => ({ ok: false, problem });
  const raw = (input.document ?? {}) as { name?: unknown; version?: unknown };
  const ledgers = declaredLedgers(input.document);
  if (ledgers.length === 0) return no(`${input.addOn} keeps no ledger an app's rows post into. list_add_ons says what each add-on offers.`);
  const ledger: Ledger | undefined = ledgers.find((candidate) => candidate.id === input.ledger);
  const offered = (of: Ledger): string => `Its actions for an app's rows: ${hostActions(input.document, of).join(', ')}.`;
  if (ledger === undefined) return no(`${input.addOn} has no ledger "${input.ledger}". Its ledgers: ${ledgers.map((candidate) => candidate.id).join(', ')}. ${offered(ledgers[0]!)}`);
  const action = ledger.actions[input.action];
  const into = `${input.addOn}/${ledger.id}/${input.action}`;
  if (action === undefined) return no(`${input.addOn}/${ledger.id} has no action "${input.action}". ${offered(ledger)}`);

  const tableRef = typeof input.table['ref'] === 'string' ? input.table['ref'] : '';
  const file = `tables/${tableRef}.json`;
  const columns = columnsOf(input.table).map((column) => ({ ...column }));
  const has = (ref: string): Json | undefined => columns.find((column) => refOf(column) === ref);

  // When each phase fires: a phase the action has, at a point the manifest can say.
  const phases: Partial<Record<(typeof PHASES)[number], { on: PostingPoint }>> = {};
  for (const phase of PHASES) {
    const given = input.when[phase];
    if (given === undefined || given === null) continue;
    if (!action.phases.includes(phase)) return no(`${into} has no "${phase}". It takes: ${action.phases.join(', ')}. Give "when" for those.`);
    const point = postingPointSchema.safeParse(given);
    if (!point.success) {
      return no(`"when.${phase}" is not a moment a rule fires at. Give one of {"create": true}, {"to": ["<state>"]}, {"column": "<column>", "in": [<value>]}, or {"column": "<column>", "set": true}.`);
    }
    phases[phase] = { on: point.data };
  }
  if (phases.post === undefined && phases.reserve === undefined) {
    return no(`Give "when": the change that takes the stock (${action.phases.filter((phase) => phase !== 'reverse').join(' or ')})${action.phases.includes('reverse') ? ', and "reverse", the change that gives it back' : ''}.`);
  }

  if (input.via !== undefined) {
    const link = has(input.via);
    if (link === undefined || link['type'] !== 'fk') return no(`"via" names the column of ${file} that links a line to the row it belongs to, and "${input.via}" is ${link === undefined ? 'not a column of it' : 'not a link ("type": "fk")'}.`);
  }

  const given = { ...(input.columns ?? {}) };
  const heldUntil = given['heldUntil'];
  delete given['heldUntil'];
  const stray = Object.keys(given).find((name) => action.inputs[name] === undefined);
  if (stray !== undefined) return no(`"${stray}" is not an input of ${into}. Its inputs are ${inputsInWords(action)}.`);

  const added: { column: string; type: string; links?: string }[] = [];
  const map: Record<string, string | { row: true }> = {};
  const grants = new Map<string, string[]>();
  const keyOf = keyColumnOf(input.document);
  const decided = new Set((action.decides ?? []).map((rule) => rule.input));

  for (const [name, type] of Object.entries(action.inputs)) {
    const named = given[name];
    // An input the app did not name: needed ones are given a column; optional ones are left to the add-on.
    if (named === undefined && optionalInput(type) && !decided.has(name)) continue;
    if (type === 'rowRef') {
      // The row itself, or the row a link of it points at (an order line's dish).
      if (named === undefined) {
        map[name] = { row: true };
        continue;
      }
      const link = has(named);
      if (link === undefined || link['type'] !== 'fk') {
        return no(`"${name}" is a row: this table's own (leave it out of "columns"), or the row a link column of it points at. "${named}" is ${link === undefined ? `not a column of ${file}` : `${String(link['type'])}, not a link ("type": "fk")`}.`);
      }
      map[name] = named;
      continue;
    }
    const kind = type.replace('?', '');
    const linked = kind === 'link' ? linkInputTable(action, name, keyOf) : null;
    const fallback = kind === 'link' ? `${name}_id` : name === 'quantity' ? 'qty' : name;
    const columnRef = named ?? fallback;
    const column = has(columnRef);
    if (column === undefined) {
      if (named !== undefined) return no(`"${named}" is not a column of ${file}. Name a column it has in "columns", or leave "${name}" out and one is added.`);
      if (kind === 'link') {
        if (linked === null) return no(`${into} does not say which table "${name}" is a row of, so no column can be added for it. Name a whole-number column of your own in "columns": { "${name}": "<column>" }.`);
        columns.push({ ref: columnRef, type: 'int', nullable: true, rules: { addOnLink: { addOn: input.addOn, table: linked } } });
        added.push({ column: columnRef, type: 'int', links: `${input.addOn}.${linked}` });
      } else if (kind === 'number' || kind === 'decimal') {
        const scale = kind === 'number' ? 3 : 4;
        columns.push({ ref: columnRef, type: 'decimal', scale });
        added.push({ column: columnRef, type: `decimal, scale ${String(scale)}` });
      } else if (kind === 'text') {
        columns.push({ ref: columnRef, type: 'text', maxLength: 200, nullable: true });
        added.push({ column: columnRef, type: 'text' });
      } else {
        return no(`"${name}" of ${into} is ${kind}: no column is added for it. Name a column of your own in "columns": { "${name}": "<column>" }.`);
      }
    } else {
      const has_ = String(column['type']);
      if (kind === 'link') {
        if (!WHOLE.has(has_)) {
          return no(`"${columnRef}" is ${has_} in ${file}, and "${name}" is a link to a row of ${input.addOn}${linked === null ? '' : `.${linked}`}: a whole number. Change its type to "int", or name another column in "columns": { "${name}": "<column>" }.`);
        }
        const rules = { ...((column['rules'] as Json | undefined) ?? {}) };
        const link = rules['addOnLink'] as { addOn?: unknown; table?: unknown } | undefined;
        if (linked !== null && (link === undefined || link.addOn !== input.addOn || link.table !== linked)) {
          if (link !== undefined) return no(`"${columnRef}" in ${file} links to ${String(link.addOn)}.${String(link.table)}, and "${name}" is a row of ${input.addOn}.${linked}. Name another column in "columns": { "${name}": "<column>" }.`);
          column['rules'] = { ...rules, addOnLink: { addOn: input.addOn, table: linked } };
          added.push({ column: columnRef, type: has_, links: `${input.addOn}.${linked}` });
        }
      } else if (kind === 'number' || kind === 'decimal') {
        if (!NUMERIC.has(has_)) {
          return no(`"${columnRef}" is ${has_} in ${file}, and the ${name} must be a number. Change its type to "decimal" with "scale": 3, or name another column in "columns": { "${name}": "<column>" }.`);
        }
      }
    }
    if (linked !== null) grants.set(linked, pickColumns(input.document, linked));
    map[name] = columnRef;
  }

  let until: string | undefined;
  if (action.holds === true && phases.reserve !== undefined) {
    const column = heldUntil === undefined ? undefined : has(heldUntil);
    if (column === undefined || !MOMENT.has(String(column['type']))) {
      return no(`This action holds stock until a time: give a date-time column of your table in "columns" as "heldUntil"${heldUntil === undefined ? '' : ` ("${heldUntil}" is ${column === undefined ? 'not a column of it' : `${String(column['type'])}, not a time`})`}.`);
    }
    until = heldUntil;
  }

  const feature = input.need === 'suggests' ? input.addOn : null;
  const posting: Posting = {
    id: ledger.id,
    into: { addOn: input.addOn, ledger: ledger.id, action: input.action },
    ...(feature === null ? {} : { needs: feature }),
    ...(input.via === undefined ? {} : { via: input.via }),
    ...phases,
    map,
    ...(until === undefined ? {} : { heldUntil: until }),
  };
  // A rule of the same name is replaced; every other rule of the table stays as it is.
  const before = Array.isArray(input.table['postings']) ? (input.table['postings'] as { id?: unknown }[]) : [];
  const postings = [...before.filter((other) => other.id !== posting.id), posting];
  const version = typeof raw.version === 'string' ? raw.version : '0.0.0';
  return {
    ok: true,
    table: { ...input.table, columns, postings },
    added,
    posting,
    addOn: { key: input.addOn, name: typeof raw.name === 'string' ? raw.name : input.addOn, range: `>=${version}` },
    feature,
    grants: [...grants].map(([table, readable]) => ({ table, readable })),
  };
}
