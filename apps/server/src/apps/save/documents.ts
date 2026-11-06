// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Save as app, one part: `documents`: the connection's document profiles.
 *
 * The inverse of `makeAppProfiles` (`documents/app-profiles.ts`). A profile
 * an install made is that install's and stays behind. Every other profile on
 * the database becomes an entry, with its tables named by ref:
 *  - its slots: a column, a column one link away, a list of child rows, a
 *    list of names one level below a line, a price's nights, rows of an
 *    add-on's table found by a pair;
 *  - the options an app decides (a statement, the request values, the rows
 *    it is for) as the entry's own fields, and the operator's own options
 *    (language, paper, formats, prefix, fixed texts) as `options`. The
 *    number column and a balance after a payment are worked out again on the
 *    target from the table's rules, so they do not travel;
 *  - the change that draws it, without the rule's id (the target makes the
 *    rule again). A profile drawn when a row is deleted has no form here;
 *  - where it goes: kept or not, and the slot it is mailed to. The slot
 *    arrives empty, for the owner to choose: the address never travels.
 *
 * A document is mailed with Adminium's own "document ready" mail, which is
 * no template of the database's, so this part names no template.
 */
import { appDocumentSchema, documentOptionsSchema, type AppDocument, type SlotMapping } from '@adminium/manifest';
import { documentProfilesRepo, type DocumentProfile } from '@adminium/meta';

import type { CollectionSource, NightlySource } from '../../documents/subject.js';
import type { ConvertContext, ConvertPart } from './types.js';
import { columnRef, noteAddOnUse, tableRefOf } from './uses.js';

type Collection = Extract<SlotMapping, { collection: unknown }>['collection'];

/** Why a part of a profile cannot be written, said once in Check. */
class LeftOut extends Error {}

function col(name: unknown): string {
  const ref = columnRef(name);
  if (ref === null) throw new LeftOut(`the column "${String(name)}" has no name a file can carry`);
  return ref;
}

function tab(ctx: ConvertContext, table: unknown): string {
  const ref = tableRefOf(ctx, table);
  if (ref === null) throw new LeftOut('it reads a table that is not saved with the app');
  return ref;
}

function where(value: unknown): { column: string; in: (string | number | boolean)[] } | undefined {
  if (value === undefined || value === null) return undefined;
  const w = value as { column?: unknown; in?: unknown };
  if (!Array.isArray(w.in)) throw new LeftOut('its rows are chosen in a way a file cannot say');
  return { column: col(w.column), in: w.in.filter((v): v is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof v)) };
}

function opt<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** A stored list of rows → the file's source: child rows by ref, or an add-on's rows by its pair. */
function collectionOf(ctx: ConvertContext, source: CollectionSource): Collection {
  const orderBy = source.orderBy === undefined || source.orderBy === null ? undefined : col(source.orderBy);
  const unless = source.unless === undefined || source.unless === null ? undefined : col(source.unless);
  if (source.pair !== undefined && source.pair !== null) {
    const columns: Record<string, string> = {};
    for (const [slotColumn, column] of Object.entries(source.columns)) columns[slotColumn] = col(column);
    const takenOff = Object.entries(source.columns)
      .filter(([, column]) => (source.takenOff ?? []).includes(column))
      .map(([slotColumn]) => slotColumn);
    return {
      addOn: source.pair.addOn,
      table: col(source.pair.table),
      match: { table: col(source.pair.matchTable), row: col(source.pair.matchRow) },
      columns,
      ...opt('orderBy', orderBy),
      ...opt('takenOff', takenOff.length === 0 ? undefined : takenOff),
      ...opt('where', where(source.where)),
      ...opt('unless', unless),
    };
  }
  const columns: Record<string, string | { list: { table: string; via: string; column: string; orderBy?: string } }> = {};
  for (const [slotColumn, column] of Object.entries(source.columns)) columns[slotColumn] = col(column);
  for (const [slotColumn, list] of Object.entries(source.lists ?? {})) {
    columns[slotColumn] = { list: { table: tab(ctx, list.table), via: col(list.fkColumn), column: col(list.column), ...opt('orderBy', list.orderBy === undefined ? undefined : col(list.orderBy)) } };
  }
  return {
    table: tab(ctx, source.table),
    via: col(source.fkColumn),
    columns,
    ...opt('orderBy', orderBy),
    ...opt('where', where(source.where)),
    ...opt('unless', unless),
  };
}

function nightlyOf(source: NightlySource): Collection {
  return { nightly: col(source.column), columns: { ...source.columns } };
}

/** A stored slot → the file's slot. */
function slotOf(ctx: ConvertContext, stored: unknown): SlotMapping {
  const s = stored as Record<string, unknown>;
  const form = s['form'] === 'grouped' ? ({ form: 'grouped' } as const) : {};
  if ('sources' in s && Array.isArray(s['sources'])) {
    const sources = (s['sources'] as Record<string, unknown>[]).map((one) => ('nightly' in one ? nightlyOf(one['nightly'] as NightlySource) : collectionOf(ctx, one['collection'] as CollectionSource)));
    return { collections: sources } as SlotMapping;
  }
  if ('collection' in s) return { collection: collectionOf(ctx, s['collection'] as CollectionSource) } as SlotMapping;
  if (typeof s['ref'] === 'string') return { via: col(s['ref']), column: col(s['column']), ...form };
  if (typeof s['column'] === 'string') return { column: col(s['column']), ...form };
  throw new LeftOut('a slot is mapped in a way a file cannot say');
}

/** A stored statement source → the file's, by ref. */
function statementSourceOf(ctx: ConvertContext, stored: unknown): NonNullable<AppDocument['statement']>['documents'] {
  const s = stored as Record<string, unknown>;
  return {
    table: tab(ctx, s['table']),
    via: col(s['via']),
    date: col(s['date']),
    amount: col(s['amount']),
    ...opt('number', s['number'] === undefined || s['number'] === null ? undefined : col(s['number'])),
    ...opt('where', where(s['where'])),
    ...opt('unless', s['unless'] === undefined || s['unless'] === null ? undefined : col(s['unless'])),
  };
}

/** The operator's own options, each kept only when the file can carry it. */
function operatorOptions(stored: Record<string, unknown>): AppDocument['options'] {
  const out: Record<string, unknown> = {};
  for (const key of ['locale', 'paper', 'formats', 'prefix', 'literals'] as const) {
    if (stored[key] === undefined || stored[key] === null) continue;
    const one = documentOptionsSchema.safeParse({ [key]: stored[key] });
    if (one.success) Object.assign(out, one.data);
  }
  return Object.keys(out).length === 0 ? undefined : (out as AppDocument['options']);
}

function entryOf(ctx: ConvertContext, profile: DocumentProfile): AppDocument {
  const table = tab(ctx, profile.table);
  const mapping: Record<string, SlotMapping> = {};
  for (const [slot, stored] of Object.entries(profile.mapping)) mapping[slot] = slotOf(ctx, stored);
  const options = profile.options;
  const statement = options['statement'] as { documents?: unknown; payments?: unknown } | undefined;
  const requestValues = Array.isArray(options['requestValues']) ? (options['requestValues'] as string[]) : undefined;

  let trigger: AppDocument['trigger'];
  if (profile.trigger !== null) {
    if (profile.trigger.event === 'record.deleted') {
      ctx.check.add({ group: 'info', code: 'DOCUMENT_TRIGGER_NO_FORM', kind: 'document', item: profile.name, field: 'trigger', message: 'It is drawn when a row is deleted, which a file cannot say: it arrives drawn by hand only.' });
    } else {
      const when = profile.trigger.when;
      if (when !== undefined && when !== null && when.op !== 'is') {
        ctx.check.add({ group: 'info', code: 'DOCUMENT_TRIGGER_NO_FORM', kind: 'document', item: profile.name, field: 'trigger', message: 'The change that draws it cannot be said in a file: it arrives drawn by hand only.' });
      } else {
        const value = when?.value;
        trigger = {
          event: profile.trigger.event,
          ...(when === undefined || when === null
            ? {}
            : { when: { column: col(when.column), ...(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? { value } : {}) } }),
        };
      }
    }
  }

  const deliver = profile.deliver as { store?: unknown; emailSlot?: unknown };
  const slot = typeof deliver.emailSlot === 'string' && deliver.emailSlot !== '' ? deliver.emailSlot : undefined;
  if (slot !== undefined) {
    ctx.check.add({ group: 'after', code: 'DOCUMENT_RECIPIENT', kind: 'document', item: profile.name, field: 'deliver.emailSlot', afterKind: 'delivery', message: 'Where it is mailed is chosen again after installing.' });
  }
  const store = typeof deliver.store === 'boolean' ? deliver.store : undefined;

  return {
    kind: profile.kind,
    addOn: profile.addOnKey,
    table,
    name: profile.name,
    mapping,
    ...(statement?.documents === undefined || statement.payments === undefined ? {} : { statement: { documents: statementSourceOf(ctx, statement.documents), payments: statementSourceOf(ctx, statement.payments) } }),
    ...opt('requestValues', requestValues === undefined || requestValues.length === 0 ? undefined : [...requestValues]),
    ...opt('where', where(options['where'])),
    ...opt('options', operatorOptions(options)),
    ...opt('trigger', trigger),
    ...(store === undefined && slot === undefined ? {} : { deliver: { ...opt('store', store), ...opt('emailSlot', slot) } }),
  };
}

/** The add-ons whose rows a document's lists read by a pair. */
function pairedAddOns(entry: AppDocument): string[] {
  const out = new Set<string>();
  for (const slot of Object.values(entry.mapping)) {
    const sources = 'collections' in slot ? slot.collections : 'collection' in slot ? [slot.collection] : [];
    for (const source of sources) if ('addOn' in source) out.add(source.addOn);
  }
  return [...out];
}

export const convertDocuments: ConvertPart = async (ctx) => {
  const { meta, connectionId } = ctx.source;
  const chosen = ctx.choices.documents === undefined ? null : new Set(ctx.choices.documents);
  const out: AppDocument[] = [];
  const taken = new Set<string>();
  for (const profile of await documentProfilesRepo(meta).list({ connectionId })) {
    // An install's profile is that install's.
    if (profile.ownerApp !== null) continue;
    if (chosen !== null && !chosen.has(profile.id)) continue;
    if (!profile.enabled) {
      ctx.check.add({ group: 'info', code: 'DOCUMENT_OFF', kind: 'document', item: profile.name, message: 'It is switched off here, so it is not saved.' });
      continue;
    }
    let entry: AppDocument;
    try {
      entry = entryOf(ctx, profile);
    } catch (error) {
      if (!(error instanceof LeftOut)) throw error;
      ctx.check.add({ group: 'info', code: 'DOCUMENT_LEFT_OUT', kind: 'document', item: profile.name, message: `It is not saved: ${error.message}.` });
      continue;
    }
    const parsed = appDocumentSchema.safeParse(entry);
    const key = `${entry.table}|${entry.kind}`;
    if (!parsed.success || taken.has(key)) {
      ctx.check.add({ group: 'info', code: 'DOCUMENT_LEFT_OUT', kind: 'document', item: profile.name, message: taken.has(key) ? 'Another document of this kind is saved for the same table, so this one is not.' : 'It is mapped in a way a file cannot say, so it is not saved.' });
      continue;
    }
    taken.add(key);
    noteAddOnUse(ctx, { key: entry.addOn, optional: true, what: 'it draws the app’s documents' });
    for (const paired of pairedAddOns(entry)) noteAddOnUse(ctx, { key: paired, optional: true, what: 'a document lists its rows' });
    out.push(parsed.data);
  }
  return out.length === 0 ? {} : { documents: out };
};
