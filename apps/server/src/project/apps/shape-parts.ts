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
import { mapShapeRules, mapShapeStates, shapeDefinitionSchema, shapeKey, type ShapeDefinition } from '@adminium/manifest';

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
