// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The part files of an app built on an add-on's shape, written from the
 * add-on's own manifest.
 *
 * An app built on `invoices/invoice@1` spells out every column, rule and
 * state of each part of the shape, and of each part of another shape those
 * name (`quote@1/document`); it sends every message the shape sends; and it
 * requires the add-on. The install compares all of it with the add-on it
 * runs on and refuses a difference. Sixty columns copied by hand, or by a
 * model, do not survive that. This copies them, swapping the part names a
 * shape uses for the app's own table names, with the same mapping the
 * install's comparison applies (`mapShapeRules`, `mapShapeStates`).
 *
 * What is the app's own is left to its author: the people the messages go to
 * (named here, never invented), the pages, the roles' grants, and the words
 * of the emails, which are written plain and are meant to be reworded.
 *
 * Pure: no I/O. The caller reads the add-on's manifest and writes the files.
 */
import { mapShapeRules, mapShapeStates, postingPointSchema, shapeDefinitionSchema, shapeKey, type PostingPoint, type ShapeDefinition } from '@adminium/manifest';

import { declaredLedgers } from './ledger-parts.js';

/** The app's table the messages are addressed through: its people, and the columns that hold an address and a name. */
export interface ShapeRecipient {
  table: string;
  email: string;
  name?: string | undefined;
}

export interface ShapePartsInput {
  appKey: string;
  /** The add-on's key and its manifest document. */
  addOn: string;
  document: unknown;
  /** The shape to build on: `invoice@1`. */
  shape: string;
  /** Required when the shape sends email. */
  recipient?: ShapeRecipient | undefined;
  /** The app's table for a part, by `<shape>@<version>/<part>`; the rest are named here. */
  tables?: Readonly<Record<string, string>> | undefined;
  /** The outbox table's name. */
  outboxTable?: string | undefined;
}

export type ShapePartsResult =
  | { ok: false; problem: string }
  | {
      ok: true;
      /** The files, by their path inside the app's `manifest/` folder. */
      files: Record<string, unknown>;
      /** One line per table made: its name, the part it is built on, and its columns. */
      tables: { ref: string; builtOn: string; part: string; columns: number }[];
      /** The message kinds the app now sends, and the outbox table, when the shape sends any. */
      outbox: { table: string; kinds: string[] } | null;
      addOn: { key: string; range: string };
    };

type Json = Record<string, unknown>;

/** `invoice_lines` → `Invoice line`. */
function words(ref: string, plural: boolean): string {
  const text = ref.split('_').join(' ');
  const out = plural || !text.endsWith('s') ? text : text.slice(0, -1);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** `clients` → `client`. */
function singular(ref: string): string {
  if (ref.endsWith('ies')) return `${ref.slice(0, -3)}y`;
  if (/(sses|xes|ches|shes|zes)$/.test(ref)) return ref.slice(0, -2);
  // `status`, `address`: an s that is the word's own.
  if (/(ss|us|is)$/.test(ref)) return ref;
  return ref.endsWith('s') ? ref.slice(0, -1) : ref;
}

/** The table a part gets when the caller names none: `invoices`, `invoice_lines`, `quote_lines`. */
function defaultTable(shape: ShapeDefinition, part: string): string {
  const base = shape.name.split('-').join('_');
  return part === 'document' ? `${base}s` : `${base}_${part}`;
}

export function shapeParts(input: ShapePartsInput): ShapePartsResult {
  const raw = (input.document as { addOn?: { shapes?: unknown[] }; version?: unknown; name?: unknown } | null) ?? {};
  const all = new Map<string, ShapeDefinition>();
  for (const candidate of raw.addOn?.shapes ?? []) {
    const parsed = shapeDefinitionSchema.safeParse(candidate);
    if (parsed.success) all.set(`${parsed.data.name}@${String(parsed.data.version)}`, parsed.data);
  }
  if (all.size === 0) return { ok: false, problem: `The add-on "${input.addOn}" defines no shape to build on.` };
  const first = all.get(input.shape);
  if (first === undefined) {
    return { ok: false, problem: `"${input.addOn}" has no shape "${input.shape}". Its shapes: ${[...all.keys()].join(', ')}.` };
  }

  // The shape, and every other shape of the add-on its columns point into.
  const used = new Map<string, ShapeDefinition>([[input.shape, first]]);
  for (const queue = [first]; queue.length > 0; ) {
    const shape = queue.shift() as ShapeDefinition;
    for (const part of Object.values(shape.parts)) {
      for (const column of part.columns) {
        const other = column.references?.includes('/') === true ? column.references.split('/')[0] : undefined;
        if (other === undefined || used.has(other)) continue;
        const found = all.get(other);
        if (found === undefined) return { ok: false, problem: `"${input.shape}" points at "${other}", which "${input.addOn}" does not define.` };
        used.set(other, found);
        queue.push(found);
      }
    }
  }

  // Each part's table. Two parts never share one.
  const tableOf = new Map<string, string>();
  for (const [id, shape] of used) {
    for (const part of Object.keys(shape.parts)) {
      const ref = input.tables?.[`${id}/${part}`] ?? defaultTable(shape, part);
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(ref)) return { ok: false, problem: `"${ref}" is not a table name: use snake_case.` };
      if ([...tableOf.values()].includes(ref)) return { ok: false, problem: `Two parts would both be the table "${ref}". Name one of them in "tables".` };
      tableOf.set(`${id}/${part}`, ref);
    }
  }

  const producers = [...used.values()].flatMap((shape) => shape.outbox?.producers ?? []);
  if (producers.length > 0 && input.recipient === undefined) {
    return {
      ok: false,
      problem: `"${input.shape}" sends email (${producers.map((producer) => producer.kind).join(', ')}), so the app needs to know who it writes to. Give "recipient": the app's own table of people (write it first), and its email and name columns.`,
    };
  }
  const recipient = input.recipient;
  const personLink = recipient === undefined ? null : `${singular(recipient.table)}_id`;
  if (recipient !== undefined && [...tableOf.values()].includes(recipient.table)) {
    return { ok: false, problem: `"${recipient.table}" is one of the shape's own tables: the recipient is a table of people the app keeps itself.` };
  }
  // The link to the person is the app's own column: a shape that already has one by that name is not built on blindly.
  if (personLink !== null && [...used.values()].some((shape) => Object.values(shape.parts).some((part) => part.columns.some((column) => column.ref === personLink)))) {
    return { ok: false, problem: `The shape already has a column "${personLink}", which is the name the link to "${recipient?.table ?? ''}" would take. Name the people's table differently.` };
  }
  /** The app's table a producer hears, by the part name the shape uses. */
  const sourceTables = new Set<string>();

  const files: Record<string, unknown> = {};
  const tables: { ref: string; builtOn: string; part: string; columns: number }[] = [];
  const mapFor = (id: string) => (ref: string): string => tableOf.get(ref.includes('/') ? ref : `${id}/${ref}`) ?? ref;

  // The producers first: the tables they hear carry the link to the person.
  const mappedProducers = [...used].flatMap(([id, shape]) =>
    (shape.outbox?.producers ?? []).map((producer) => {
      const out: Json = { ...(producer as Json) };
      for (const when of ['onCreate', 'onChange', 'before'] as const) {
        const rule = out[when] as { table?: string } | undefined;
        if (rule?.table === undefined) continue;
        const table = mapFor(id)(rule.table);
        out[when] = { ...rule, table };
        sourceTables.add(table);
      }
      return out as Json & { kind: string; link: string };
    }),
  );

  for (const [id, shape] of used) {
    const map = mapFor(id);
    for (const [partName, part] of Object.entries(shape.parts)) {
      const ref = tableOf.get(`${id}/${partName}`) as string;
      const columns: Json[] = part.columns.map((column) => {
        const out: Json = { ...(column as unknown as Json) };
        if (column.references !== undefined) out['references'] = map(column.references);
        if (column.rules !== undefined) out['rules'] = mapShapeRules(column.rules, map);
        return out;
      });
      // The app's own column: who a message about this row goes to. Nullable, as an added column must be.
      if (personLink !== null && recipient !== undefined && sourceTables.has(ref) && !columns.some((column) => column['ref'] === personLink)) {
        columns.push({ ref: personLink, type: 'fk', references: recipient.table, nullable: true, label: { 'en-US': words(singular(recipient.table), false) } });
      }
      const key = columns.find((column) => column['ref'] === 'number') ?? columns.find((column) => column['type'] === 'text') ?? columns[0];
      files[`tables/${ref}.json`] = {
        ref,
        builtOn: shapeKey(input.addOn, shape),
        part: partName,
        label: { 'en-US': words(ref, false) },
        labelPlural: { 'en-US': words(ref, true) },
        keyField: key?.['ref'] ?? 'id',
        columns,
        ...(part.states === undefined ? {} : { states: mapShapeStates(part.states, map) }),
      };
      tables.push({ ref, builtOn: shapeKey(input.addOn, shape), part: partName, columns: columns.length });
    }
  }

  let outbox: { table: string; kinds: string[] } | null = null;
  if (mappedProducers.length > 0 && recipient !== undefined && personLink !== null) {
    const table = input.outboxTable ?? 'messages';
    if ([...tableOf.values()].includes(table)) return { ok: false, problem: `"${table}" is one of the shape's tables: give the outbox another name in "outboxTable".` };
    const kinds = [...new Set(mappedProducers.map((producer) => producer.kind))];
    // The foreign keys a producer links by, and the table each points at: the one its producer hears.
    const links = new Map<string, string>();
    for (const producer of mappedProducers) {
      const heard = (['onCreate', 'onChange', 'before'] as const).map((when) => (producer[when] as { table?: string } | undefined)?.table).find((found) => found !== undefined);
      if (heard !== undefined && !links.has(producer.link)) links.set(producer.link, heard);
    }
    const holds = mappedProducers.some((producer) => producer['hold'] === true);
    const label = (kind: string): string => words(kind.split('-').join('_'), true);
    files[`tables/${table}.json`] = {
      ref: table,
      label: { 'en-US': words(table, false) },
      labelPlural: { 'en-US': words(table, true) },
      keyField: 'kind',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'kind', type: 'enum', enum: kinds, default: kinds[0], label: { 'en-US': 'Kind' }, rules: { enumLabels: { labels: Object.fromEntries(kinds.map((kind) => [kind, label(kind)])) } } },
        { ref: 'status', type: 'enum', enum: ['queued', ...(holds ? ['held'] : []), 'sent', 'failed', 'skipped'], default: 'queued', label: { 'en-US': 'Status' } },
        { ref: 'to_address', type: 'text', maxLength: 320, nullable: true, label: { 'en-US': 'To' } },
        { ref: personLink, type: 'fk', references: recipient.table, nullable: true, label: { 'en-US': words(singular(recipient.table), false) } },
        ...[...links].filter(([link]) => link !== personLink).map(([link, target]) => ({ ref: link, type: 'fk', references: target, nullable: true, label: { 'en-US': words(singular(target), false) } })),
        { ref: 'due_at', type: 'timestamptz', nullable: true, label: { 'en-US': 'Due' } },
        { ref: 'skip_reason', type: 'text', maxLength: 40, nullable: true },
        { ref: 'subject_override', type: 'text', maxLength: 200, nullable: true },
        { ref: 'body_override', type: 'text', nullable: true },
        { ref: 'approved_by', type: 'text', maxLength: 120, nullable: true },
        { ref: 'sent_at', type: 'timestamptz', nullable: true },
        { ref: 'error', type: 'text', nullable: true },
        { ref: 'created_at', type: 'timestamptz', role: 'created_at', default: 'now' },
      ],
    };
    const linkName = (link: string): string => link.replace(/_id$/, '');
    files['emails.json'] = {
      outbox: {
        table,
        columns: {
          kind: 'kind',
          status: 'status',
          to: 'to_address',
          due: 'due_at',
          skipReason: 'skip_reason',
          subjectOverride: 'subject_override',
          bodyOverride: 'body_override',
          approvedBy: 'approved_by',
          sentAt: 'sent_at',
          error: 'error',
        },
        links: Object.fromEntries([[linkName(personLink), personLink], ...[...links.keys()].filter((link) => link !== personLink).map((link) => [linkName(link), link])]),
        recipient: { via: personLink, table: recipient.table, email: recipient.email, ...(recipient.name === undefined ? {} : { name: recipient.name }) },
        kinds: Object.fromEntries(kinds.map((kind) => [kind, `${input.appKey}-${kind}`])),
        producers: mappedProducers,
      },
      // Plain words, to be reworded: the app's emails are its own.
      emailTemplates: kinds.map((kind) => ({
        key: `${input.appKey}-${kind}`,
        name: { 'en-US': label(kind) },
        locales: {
          'en-US': {
            subject: `${label(kind)} from {{appName}}`,
            blocks: [
              { block: 'email.text', data: { text: 'Hello {{recipient.first_name}},' } },
              { block: 'email.text', data: { text: `This message is about: ${label(kind).toLowerCase()}.` } },
            ],
            footer: '{{appName}}',
          },
        },
      })),
    };
    outbox = { table, kinds };
  }

  const version = typeof raw.version === 'string' ? raw.version : '0.0.0';
  const name = typeof raw.name === 'string' ? raw.name : input.addOn;
  files['add-ons.json'] = { requires: [{ key: input.addOn, range: `>=${version}`, reason: { 'en-US': `${words(first.name.split('-').join('_'), true)} are made by ${name}.` } }] };
  return { ok: true, files, tables, outbox, addOn: { key: input.addOn, range: `>=${version}` } };
}

/**
 * A shape whose parts carry a rule (`adjust`, `postings`) is not built as new
 * tables: it is ADDED to tables the app already has. An order that takes
 * discounts is the app's own orders table with a few more columns and the
 * rule; nothing says `builtOn`, and the install checks the rule against the
 * add-on by its names alone. This writes those columns and rules, with the
 * part names and the shape's column names swapped for the app's.
 */
export interface AdoptPartsInput {
  /** The add-on's key and its manifest document. */
  addOn: string;
  document: unknown;
  /** The shape to add: `card-sale@1`. */
  shape: string;
  /** The app's table for each part, by `<shape>@<version>/<part>` (or the part's name alone). */
  tables?: Readonly<Record<string, string>> | undefined;
  /** The app's table files as they read now, by ref. */
  have: Readonly<Record<string, Json>>;
  /** The moment each step of the shape's postings happens; the shape's own where none is given. */
  when?: { reserve?: unknown; post?: unknown; reverse?: unknown } | undefined;
  /** A shape column → a column the app already has: `amount`, or `lines.amount` where two parts have one of that name. */
  columns?: Readonly<Record<string, string>> | undefined;
  /** `suggests`: the app runs without the add-on, and the rules are live only while it is there. */
  need?: 'requires' | 'suggests' | undefined;
}

export interface AdoptedTable {
  ref: string;
  part: string;
  /** A table written new (a part that only keeps rows, as the codes typed on an order). */
  made: boolean;
  /** The columns added, and the columns the table had that were given a link into the add-on. */
  added: { column: string; type: string; links?: string; given?: true }[];
  /** The shape's columns the table already had: the shape's name, and the app's. */
  used: { column: string; as: string }[];
  /** The rules written, in words. */
  rules: string[];
}

export type AdoptPartsResult =
  | { ok: false; problem: string }
  | {
      ok: true;
      /** The table files, by their path inside the app's `manifest/` folder. */
      files: Record<string, Json>;
      tables: AdoptedTable[];
      /** The add-on, the range the app names, and the first Adminium the add-on itself runs on. */
      addOn: { key: string; name: string; range: string; floor: string | null };
      /** With `suggests`: the feature the rules are live under. */
      feature: string | null;
      /** The add-on's tables the added columns link into. */
      links: string[];
      /** What a price rule's line was told of this shape's rows, on a table that is no part of it: the table, and the words. */
      told: { ref: string; rule: string }[];
    };

const PHASES = ['reserve', 'post', 'reverse'] as const;
type Phase = (typeof PHASES)[number];
const KINDS: Readonly<Record<string, string>> = { int: 'number', bigint: 'number', decimal: 'number', float: 'number', money: 'number', text: 'text', enum: 'text', timestamptz: 'time', date: 'time', bool: 'yes/no' };
const WHOLE = new Set(['int', 'bigint']);
const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const refOf = (column: Json): string => (typeof column['ref'] === 'string' ? column['ref'] : '');

/** Whether a shape is added to the app's own tables: any part of it carries a rule. */
export function spelledOut(document: unknown, shape: string): boolean {
  const shapes = (document as { addOn?: { shapes?: { name?: unknown; version?: unknown; parts?: Record<string, unknown> }[] } } | null)?.addOn?.shapes ?? [];
  const found = shapes.find((candidate) => `${String(candidate.name)}@${String(candidate.version)}` === shape);
  return Object.values(found?.parts ?? {}).some((part) => typeof part === 'object' && part !== null && ('postings' in part || 'adjust' in part));
}

export function adoptParts(input: AdoptPartsInput): AdoptPartsResult {
  const no = (problem: string): AdoptPartsResult => ({ ok: false, problem });
  const raw = (input.document as { addOn?: { shapes?: unknown[] }; version?: unknown; name?: unknown; compatibility?: { minAdminiumVersion?: unknown } } | null) ?? {};
  const all = new Map<string, ShapeDefinition>();
  for (const candidate of raw.addOn?.shapes ?? []) {
    const parsed = shapeDefinitionSchema.safeParse(candidate);
    if (parsed.success) all.set(`${parsed.data.name}@${String(parsed.data.version)}`, parsed.data);
  }
  const shape = all.get(input.shape);
  if (shape === undefined) return no(`"${input.addOn}" has no shape "${input.shape}". Its shapes: ${[...all.keys()].join(', ') || 'none'}.`);
  type Part = ShapeDefinition['parts'][string] & { adjust?: Json; postings?: Json[]; inAdjust?: { excludes?: string; paidBy?: string } };
  const parts = Object.entries(shape.parts) as [string, Part][];
  const partNames = parts.map(([name]) => name);
  const partOf = (name: string): Part => shape.parts[name] as Part;
  /** The part a part's rows belong to: the one its foreign key names. */
  const parentOf = (name: string): { part: string; column: string } | null => {
    const link = partOf(name).columns.find((column) => column.references !== undefined && partNames.includes(column.references));
    return link === undefined ? null : { part: link.references as string, column: link.ref };
  };
  const priced = new Set(parts.flatMap(([, part]) => ((part.adjust?.['lines'] as { table?: string }[] | undefined) ?? []).flatMap((line) => (typeof line.table === 'string' ? [line.table] : []))));
  /** A part that only keeps rows may be a table written here; every other is the app's own, and is there first. */
  const mayBeNew = (name: string): boolean => parentOf(name) !== null && partOf(name).adjust === undefined && partOf(name).postings === undefined && !priced.has(name);

  // Each part's table.
  const named = input.tables ?? {};
  const example = `Give "tables": { ${partNames.map((name) => `"${input.shape}/${name}": "${mayBeNew(name) ? '<a new table’s name>' : `<your ${parentOf(name) === null ? `${name}s` : name} table>`}"`).join(', ')} }.`;
  const stray = Object.keys(named).find((key) => !partNames.some((name) => key === name || key === `${input.shape}/${name}`));
  if (stray !== undefined) return no(`"${stray}" is not a part of ${input.shape}. Its parts: ${partNames.join(', ')}. ${example}`);
  const tableOf = new Map<string, string>();
  for (const name of partNames) {
    const ref = named[`${input.shape}/${name}`] ?? named[name];
    if (ref === undefined) return no(`${input.shape} is added to tables the app already has. ${example}`);
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(ref)) return no(`"${ref.slice(0, 80)}" is not a table name: use snake_case.`);
    if ([...tableOf.values()].includes(ref)) return no(`Two parts would both be the table "${ref}": each part of ${input.shape} is a table of its own. ${example}`);
    tableOf.set(name, ref);
  }
  for (const name of partNames) {
    const ref = tableOf.get(name) as string;
    if (input.have[ref] === undefined && !mayBeNew(name)) {
      return no(`There is no table "${ref}" yet. Write tables/${ref}.json first (the app's own ${name === 'order' ? 'orders' : name}, nothing about ${input.addOn}), then call this again.`);
    }
  }

  // Which of the app's columns stands for each of the shape's.
  const pairs = { ...(input.columns ?? {}) };
  const taken = new Set<string>();
  const paired = (part: string, column: string): string | undefined => {
    for (const key of [`${part}.${column}`, column]) {
      if (pairs[key] !== undefined) {
        taken.add(key);
        return pairs[key];
      }
    }
    return undefined;
  };
  const table = (part: string): Json | undefined => input.have[tableOf.get(part) as string];
  const columnsOf = (part: string): Json[] => {
    const file = table(part);
    return file !== undefined && Array.isArray(file['columns']) ? (file['columns'] as Json[]) : [];
  };
  const fileOf = (part: string): string => `tables/${tableOf.get(part) as string}.json`;

  // When each step happens: the caller's moment, else the shape's own.
  const given: Partial<Record<Phase, PostingPoint>> = {};
  for (const phase of PHASES) {
    const moment = input.when?.[phase];
    if (moment === undefined || moment === null) continue;
    const point = postingPointSchema.safeParse(moment);
    if (!point.success) {
      return no(`"when.${phase}" is not a moment a rule fires at. Give one of {"create": true}, {"to": ["<state>"]}, {"column": "<column>", "in": [<value>]}, or {"column": "<column>", "set": true}.`);
    }
    given[phase] = point.data;
  }
  const ledgers = declaredLedgers(input.document);
  /** The columns the shape's own moments read, by part: left out when the caller's moment replaces every one that reads them. */
  const momentOnly = new Map<string, Set<string>>(partNames.map((name) => [name, new Set<string>()]));
  const momentKept = new Map<string, Set<string>>(partNames.map((name) => [name, new Set<string>()]));
  const pointsOf = new Map<string, Partial<Record<Phase, { on: PostingPoint; shapes: boolean }>>>();
  for (const [name, part] of parts) {
    for (const posting of part.postings ?? []) {
      const id = String(posting['id']);
      const into = posting['into'] as { ledger: string; action: string };
      const phases = (ledgers.find((ledger) => ledger.id === into.ledger)?.actions[into.action]?.phases ?? PHASES) as readonly string[];
      const up = posting['via'] === undefined ? null : parentOf(name);
      const out: Partial<Record<Phase, { on: PostingPoint; shapes: boolean }>> = {};
      for (const phase of PHASES) {
        const own = (posting[phase] as { on: PostingPoint } | undefined)?.on;
        if (own !== undefined && 'column' in own) (own.own === true || up === null ? momentOnly.get(name) : momentOnly.get(up.part))?.add(own.column);
        const moment = given[phase];
        if (moment === undefined) {
          if (own !== undefined) {
            out[phase] = { on: own, shapes: true };
            if ('column' in own) (own.own === true || up === null ? momentKept.get(name) : momentKept.get(up.part))?.add(own.column);
          }
          continue;
        }
        if (!phases.includes(phase)) return no(`${input.addOn}/${into.ledger}/${into.action} has no "${phase}". It takes: ${phases.join(', ')}. Give "when" for those.`);
        if (!('column' in moment)) {
          out[phase] = { on: moment, shapes: false };
          continue;
        }
        // The caller's column: of this table (a line's own change), else of the row its lines belong to.
        const inPart = (candidate: string): boolean => columnsOf(candidate).some((column) => refOf(column) === moment.column) || partOf(candidate).columns.some((column) => column.ref === moment.column);
        const home = moment.own === true || up === null ? (inPart(name) ? name : null) : inPart(name) && !columnsOf(up.part).some((column) => refOf(column) === moment.column) ? name : inPart(up.part) ? up.part : null;
        if (home === null) {
          return no(`"${moment.column}" in "when.${phase}" is not a column of ${[fileOf(name), ...(up === null || moment.own === true ? [] : [fileOf(up.part)])].join(' or ')}. Add it to the table whose change it is, then call this again.`);
        }
        const { own: _own, ...plain } = moment;
        out[phase] = { on: (home === name && up !== null ? { ...plain, own: true } : plain) as PostingPoint, shapes: false };
        if (partOf(home).columns.some((column) => column.ref === moment.column)) momentKept.get(home)?.add(moment.column);
      }
      pointsOf.set(`${name}/${id}`, out);
    }
  }
  /** Every name a rule of the shape reads, by part: a column a moment reads and nothing else does is the moment's alone. */
  const ruled = new Map<string, Set<string>>(partNames.map((name) => [name, new Set<string>()]));
  const reads = (part: string, value: unknown): void => {
    if (typeof value === 'string') ruled.get(part)?.add(value);
  };
  for (const [name, part] of parts) {
    for (const posting of part.postings ?? []) {
      for (const mapped of Object.values((posting['map'] as Json | undefined) ?? {})) {
        if (typeof mapped === 'string') reads(name, mapped);
        else if (isJson(mapped) && typeof mapped['parent'] === 'string') reads(parentOf(name)?.part ?? name, mapped['parent']);
      }
    }
    const adjust = part.adjust;
    if (adjust === undefined) continue;
    for (const line of (adjust['lines'] as Json[] | undefined) ?? []) {
      const of = String(line['table']);
      for (const key of ['via', 'price', 'quantity', 'discount']) reads(of, line[key]);
      for (const what of (line['what'] as Json[] | undefined) ?? []) reads(of, what['column']);
      for (const key of ['excludes', 'paidBy']) reads(of, (line[key] as Json | undefined)?.['column']);
    }
    const walk = (value: unknown): void => {
      if (typeof value === 'string') reads(name, value);
      else if (isJson(value)) Object.values(value).forEach(walk);
    };
    walk(adjust['order']);
    for (const key of ['codes', 'refunds']) {
      const child = adjust[key] as Json | undefined;
      if (child === undefined) continue;
      for (const [field, value] of Object.entries(child)) if (field !== 'table') reads(String(child['table']), value);
    }
  }
  const what = new Set(parts.flatMap(([, part]) => ((part.adjust?.['lines'] as Json[] | undefined) ?? []).flatMap((line) => ((line['what'] as Json[] | undefined) ?? []).map((entry) => `${String(line['table'])}.${String(entry['column'])}`))));

  // The shape's columns on the app's tables: one the table has is used, the rest are added.
  const colOf = new Map<string, string>();
  const adding = new Map<string, ShapeDefinition['parts'][string]['columns'][number][]>(partNames.map((name) => [name, []]));
  const out = new Map<string, AdoptedTable>();
  const next = new Map<string, Json[]>();
  for (const [name, part] of parts) {
    const ref = tableOf.get(name) as string;
    const made = table(name) === undefined;
    const columns = columnsOf(name).map((column) => ({ ...column }));
    const report: AdoptedTable = { ref, part: name, made, added: [], used: [], rules: [] };
    out.set(name, report);
    next.set(name, columns);
    const up = parentOf(name);
    for (const column of part.columns) {
      const key = `${name}.${column.ref}`;
      if (column.role === 'pk') {
        const pk = columns.find((candidate) => candidate['role'] === 'pk');
        if (made) columns.push({ ref: 'id', type: 'int', role: 'pk' });
        colOf.set(key, pk === undefined ? 'id' : refOf(pk));
        continue;
      }
      if (up !== null && column.ref === up.column) {
        const target = tableOf.get(up.part) as string;
        const wanted = paired(name, column.ref);
        if (made) {
          const link = wanted ?? `${singular(target)}_id`;
          columns.push({ ref: link, type: 'fk', references: target });
          colOf.set(key, link);
          continue;
        }
        const links = columns.filter((candidate) => candidate['type'] === 'fk' && candidate['references'] === target).map(refOf);
        if (wanted !== undefined && !links.includes(wanted)) return no(`"${wanted}" is not a link from ${fileOf(name)} to "${target}". ${links.length === 0 ? 'It has none' : `Its links to it: ${links.join(', ')}`}.`);
        if (wanted === undefined && links.length === 0) {
          return no(`${fileOf(name)} has no link to "${target}". Add { "ref": "${singular(target)}_id", "type": "fk", "references": "${target}" } to its columns, then call this again.`);
        }
        if (wanted === undefined && links.length > 1) return no(`${fileOf(name)} links to "${target}" by ${links.join(', ')}: say which in "columns": { "${key}": "<column>" }.`);
        colOf.set(key, wanted ?? (links[0] as string));
        continue;
      }
      // A column only the shape's own moment reads, where the caller gave another moment: not this app's.
      if (momentOnly.get(name)?.has(column.ref) === true && momentKept.get(name)?.has(column.ref) !== true && ruled.get(name)?.has(column.ref) !== true) continue;
      const wanted = paired(name, column.ref);
      const has = columns.find((candidate) => refOf(candidate) === (wanted ?? column.ref));
      if (has === undefined) {
        // What a line sells is the app's own link to the thing sold: never a column this could add.
        if (what.has(key)) {
          return no(
            `"${column.ref}" of ${input.shape} says what a line sells: ${wanted === undefined ? 'a link from your own table to the thing sold' : `"${wanted}" is not a column of ${fileOf(name)}`}. Name the link column ${fileOf(name)} has (its "type" is "fk") in "columns": { "${key}": "<column>" }.`,
          );
        }
        if (wanted !== undefined) return no(`"${wanted}" is not a column of ${fileOf(name)}. Name a column it has in "columns", or leave "${column.ref}" out and it is added.`);
        colOf.set(key, column.ref);
        adding.get(name)?.push(column);
        continue;
      }
      const link = column.rules?.addOnLink as { addOn: string; table: string } | undefined;
      const type = String(has['type']);
      const again = `name another column in "columns": { "${key}": "<column>" }`;
      if (link !== undefined) {
        if (!WHOLE.has(type)) return no(`"${refOf(has)}" is ${type} in ${fileOf(name)}, and "${column.ref}" of ${input.shape} is a link to a row of ${link.addOn}.${link.table}: a whole number. Change its type to "int", or ${again}.`);
        const rules = { ...((has['rules'] as Json | undefined) ?? {}) };
        const now = rules['addOnLink'] as { addOn?: unknown; table?: unknown } | undefined;
        if (now !== undefined && (now.addOn !== link.addOn || now.table !== link.table)) return no(`"${refOf(has)}" in ${fileOf(name)} links to ${String(now.addOn)}.${String(now.table)}, and "${column.ref}" of ${input.shape} is a row of ${link.addOn}.${link.table}. Take that link off it, or ${again}.`);
        if (now === undefined) {
          if (has['references'] !== undefined) return no(`"${refOf(has)}" in ${fileOf(name)} has "references": it links to a table of this app, and "${column.ref}" of ${input.shape} is a row of ${link.addOn}.${link.table}. Take "references" off it, or ${again}.`);
          has['rules'] = { ...rules, addOnLink: link };
          has['nullable'] = true;
          delete has['default'];
          report.added.push({ column: refOf(has), type, links: `${link.addOn}.${link.table}`, given: true });
        }
      } else if (!what.has(key) && KINDS[type] !== KINDS[column.type] && !(type === 'fk' && column.type === 'text')) {
        return no(`"${refOf(has)}" is ${type} in ${fileOf(name)}, and "${column.ref}" of ${input.shape} is ${column.type}. Change its type to "${column.type}", or ${again}.`);
      }
      colOf.set(key, refOf(has));
      report.used.push({ column: column.ref, as: refOf(has) });
    }
  }
  const unused = Object.keys(pairs).find((key) => !taken.has(key));
  if (unused !== undefined) {
    return no(`"${unused}" in "columns" is not a column of ${input.shape}. Its columns: ${parts.map(([name, part]) => `${name}: ${part.columns.filter((column) => column.role !== 'pk').map((column) => column.ref).join(', ')}`).join('; ')}. Write one as "<part>.<column>" where two parts have a column of that name.`);
  }

  const at = (part: string, column: unknown): unknown => (typeof column === 'string' ? (colOf.get(`${part}.${column}`) ?? column) : column);
  const mapTable = (ref: string): string => tableOf.get(ref) ?? ref;
  const deep = (part: string, value: unknown): unknown => (Array.isArray(value) ? value.map((entry) => deep(part, entry)) : isJson(value) ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deep(part, entry)])) : at(part, value));
  const feature = input.need === 'suggests' ? input.addOn : null;
  const links = new Set<string>();
  const files: Record<string, Json> = {};

  for (const [name, part] of parts) {
    const ref = tableOf.get(name) as string;
    const report = out.get(name) as AdoptedTable;
    const columns = next.get(name) as Json[];
    for (const column of adding.get(name) ?? []) {
      const copy: Json = { ...(column as unknown as Json) };
      if (column.rules !== undefined) {
        const rules: Json = { ...(mapShapeRules(column.rules, mapTable) as Json) };
        const rollup = (column.rules as Json)['rollup'] as Json | undefined;
        if (rollup !== undefined) {
          const from = String(rollup['from']);
          rules['rollup'] = { ...rollup, from: mapTable(from), via: at(from, rollup['via']), ...(rollup['sum'] === undefined ? {} : { sum: at(from, rollup['sum']) }) };
        }
        if ((column.rules as Json)['formula'] !== undefined) rules['formula'] = deep(name, (column.rules as Json)['formula']);
        const lookup = (column.rules as Json)['lookup'] as Json | undefined;
        if (lookup !== undefined) rules['lookup'] = { ...lookup, from: at(name, lookup['from']) };
        copy['rules'] = rules;
      }
      columns.push(copy);
      const link = column.rules?.addOnLink as { addOn: string; table: string } | undefined;
      report.added.push({ column: column.ref, type: column.type, ...(link === undefined ? {} : { links: `${link.addOn}.${link.table}` }) });
    }
    for (const added of report.added) if (added.links !== undefined) links.add(added.links);

    const file: Json = table(name) === undefined ? { ref, label: { 'en-US': words(singular(ref), false) }, labelPlural: { 'en-US': words(ref, true) }, keyField: 'id', columns } : { ...(table(name) as Json), columns };
    const postings = (part.postings ?? []).map((posting) => {
      const points = pointsOf.get(`${name}/${String(posting['id'])}`) ?? {};
      const up = parentOf(name);
      const { reserve: _reserve, post: _post, reverse: _reverse, ...rest } = posting;
      const mapped: Json = {
        ...rest,
        ...(feature === null ? {} : { needs: feature }),
        ...(posting['via'] === undefined ? {} : { via: at(name, posting['via']) }),
        map: Object.fromEntries(
          Object.entries((posting['map'] as Json | undefined) ?? {}).map(([inputName, from]) => [inputName, typeof from === 'string' ? at(name, from) : isJson(from) && typeof from['parent'] === 'string' ? { parent: at(up?.part ?? name, from['parent']) } : from]),
        ),
      };
      for (const phase of PHASES) {
        const point = points[phase];
        if (point === undefined) continue;
        const on = point.on;
        // The shape's own moment names the shape's column: the app's stands in for it.
        mapped[phase] = { on: point.shapes && 'column' in on ? { ...on, column: at(on.own === true || up === null || posting['via'] === undefined ? name : up.part, on.column) } : on };
      }
      const into = posting['into'] as { ledger: string; action: string };
      report.rules.push(`the rule "${String(posting['id'])}" posts into ${input.addOn}/${into.ledger} (${into.action})`);
      return mapped;
    });
    if (postings.length > 0) {
      const before = Array.isArray(file['postings']) ? (file['postings'] as Json[]) : [];
      file['postings'] = [...before.filter((other) => !postings.some((posting) => posting['id'] === other['id'])), ...postings];
    }
    if (part.adjust !== undefined) {
      const adjust = part.adjust;
      const child = (block: Json | undefined): Json | undefined => {
        if (block === undefined) return undefined;
        const of = String(block['table']);
        return Object.fromEntries(Object.entries(block).map(([key, value]) => [key, key === 'table' ? mapTable(of) : at(of, value)]));
      };
      file['adjust'] = {
        ...adjust,
        ...(feature === null ? {} : { needs: feature }),
        lines: ((adjust['lines'] as Json[] | undefined) ?? []).map((line) => {
          const of = String(line['table']);
          const one = (key: string): Json => (line[key] === undefined ? {} : { [key]: { ...(line[key] as Json), column: at(of, (line[key] as Json)['column']) } });
          return {
            ...line,
            table: mapTable(of),
            via: at(of, line['via']),
            price: at(of, line['price']),
            ...(line['quantity'] === undefined ? {} : { quantity: at(of, line['quantity']) }),
            discount: at(of, line['discount']),
            ...(line['what'] === undefined ? {} : { what: (line['what'] as Json[]).map((entry) => ({ ...entry, column: at(of, entry['column']) })) }),
            ...one('excludes'),
            ...one('paidBy'),
          };
        }),
        order: deep(name, adjust['order']),
        ...(adjust['codes'] === undefined ? {} : { codes: child(adjust['codes'] as Json) }),
        ...(adjust['refunds'] === undefined ? {} : { refunds: child(adjust['refunds'] as Json) }),
      };
      report.rules.push(`the "adjust" rule: ${input.addOn} answers the price of a row of "${ref}"`);
    }
    files[`tables/${ref}.json`] = file;
  }

  // What a line that sells the add-on's own value is to a price rule on the same lines: left out of every reduction
  // (a card load), or sold to pay later (a voucher). The sale's shape says which; the price rule's line carries it,
  // whichever of the two shapes was added first.
  const told: { ref: string; rule: string }[] = [];
  const tell = (line: Json, word: 'excludes' | 'paidBy', column: string): boolean => {
    const next = word === 'excludes' ? { column, set: true } : { column };
    if (JSON.stringify(line[word]) === JSON.stringify(next)) return false;
    line[word] = next;
    return true;
  };
  const wordOf = (part: Part): ['excludes' | 'paidBy', string] | null => (part.inAdjust === undefined ? null : (Object.entries(part.inAdjust)[0] as ['excludes' | 'paidBy', string]));
  // This shape's own parts, told to every price rule of this add-on that prices their table.
  for (const [name, part] of parts) {
    const word = wordOf(part);
    if (word === null) continue;
    const ref = tableOf.get(name) as string;
    const column = at(name, word[1]) as string;
    for (const [other, now] of Object.entries({ ...input.have, ...Object.fromEntries(Object.values(files).map((value) => [String(value['ref']), value])) })) {
      const adjust = (files[`tables/${other}.json`] ?? now)['adjust'] as { by?: { addOn?: string }; lines?: Json[] } | undefined;
      if (adjust?.by?.addOn !== input.addOn || !(adjust.lines ?? []).some((line) => line['table'] === ref)) continue;
      const copy = structuredClone(files[`tables/${other}.json`] ?? now);
      let changed = false;
      for (const line of (copy['adjust'] as { lines: Json[] }).lines) if (line['table'] === ref && tell(line, word[0], column)) changed = true;
      if (!changed) continue;
      files[`tables/${other}.json`] = copy;
      told.push({ ref: other, rule: `its price rule's lines of "${ref}" now say "${word[0]}": a line that fills ${column} ${word[0] === 'excludes' ? 'takes no reduction' : 'is something sold, and takes no reduction'}` });
    }
  }
  // This shape's own price rule, told of the add-on's other shapes already on its lines: found by the rule each wrote.
  for (const [name, part] of parts) {
    if (part.adjust === undefined) continue;
    const file = files[`tables/${tableOf.get(name) as string}.json`] as Json;
    for (const line of (file['adjust'] as { lines: Json[] }).lines) {
      const lines = files[`tables/${String(line['table'])}.json`] ?? input.have[String(line['table'])];
      const written = lines === undefined || !Array.isArray(lines['postings']) ? [] : (lines['postings'] as Json[]);
      for (const other of all.values()) {
        for (const sale of Object.values(other.parts) as Part[]) {
          const word = wordOf(sale);
          if (word === null) continue;
          for (const posting of sale.postings ?? []) {
            const fed = Object.entries((posting['map'] as Json | undefined) ?? {}).find(([, from]) => from === word[1])?.[0];
            const mine = written.find((candidate) => candidate['id'] === posting['id'] && (candidate['into'] as { addOn?: string } | undefined)?.addOn === input.addOn);
            const column = fed === undefined ? undefined : (mine?.['map'] as Json | undefined)?.[fed];
            if (typeof column === 'string' && tell(line, word[0], column)) (out.get(name) as AdoptedTable).rules.push(`its lines of "${String(line['table'])}" say "${word[0]}" for ${column}`);
          }
        }
      }
    }
  }

  const version = typeof raw.version === 'string' ? raw.version : '0.0.0';
  const floor = raw.compatibility?.minAdminiumVersion;
  return {
    ok: true,
    told,
    files,
    tables: [...out.values()],
    addOn: { key: input.addOn, name: typeof raw.name === 'string' ? raw.name : input.addOn, range: `>=${version}`, floor: typeof floor === 'string' ? floor : null },
    feature,
    links: [...links],
  };
}
