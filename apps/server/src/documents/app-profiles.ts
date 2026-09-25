// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The document profiles an app's install makes, and its uninstall takes back.
 *
 * An app whose invoices are built on an add-on's shape (`builtOn:
 * "invoices/invoice@1"`, `part: "document"`) gets the shape's own document
 * profiles — an invoice, a receipt, a statement — made for ITS tables with
 * its real names, so nobody maps twenty columns to twenty slots by hand in
 * Studio. An app may also list documents of its own (`documents`).
 *
 * ─── WHO OWNS WHAT ─────────────────────────────────────────────────────────
 *
 * Every profile made here carries `owner_app`: the app's key. The install
 * makes them; an update changes them IN PLACE, so the documents already
 * issued keep pointing at their profile; what the new version no longer asks
 * for is removed; the uninstall removes the app's profiles and nothing else.
 * An operator's own profile (no owner) is never changed or removed here, even
 * one on the app's own tables with the same name — that one is skipped with
 * a reason instead.
 *
 * ─── AN APP'S ENTRY EXTENDS ITS SHAPE'S PROFILE ────────────────────────────
 *
 * A shape can only name its own parts' columns, but a printed invoice also
 * needs the client's company and address — the app's own columns
 * (`invoices.client_id` → `clients`). So an app `documents` entry on a table
 * built on a shape, of a kind that shape already makes for it, does not make
 * a second profile: its slots are ADDED to the shape's mapping (the app's
 * slot wins on the same id) and its name replaces the shape's. Any other
 * entry makes a profile of its own.
 *
 * ─── NEVER HALF A PROFILE ──────────────────────────────────────────────────
 *
 * A profile whose add-on is not installed (or does not define the shape the
 * table is built on) is skipped, with a reason the install reply can show.
 * So is one whose mapping names a table the install did not make. A profile
 * is either made whole or not at all.
 */
import type { AppDocument, AppManifest, ShapeDefinition, SlotMapping as ManifestSlotMapping } from '@adminium/manifest';
import { shapeDefinitionSchema, shapeKey } from '@adminium/manifest';
import { documentProfilesRepo, manifestsRepo, type DocumentProfile, type MetaDb } from '@adminium/meta';

import type { StatementSource, StatementSources } from './statement.js';
import type { ProfileMapping, SlotMapping } from './subject.js';
import { syncProfileTrigger } from './trigger-sync.js';

/** The shapes the installed add-ons define, by `<addOn>/<name>@<version>`. */
export interface InstalledShapes {
  byKey: ReadonlyMap<string, ShapeDefinition>;
  /** Every add-on installed on this server (on or off), by key. */
  addOns: ReadonlySet<string>;
}

/** The manifest store's rows need no secrets here: nothing below reads a credential. */
const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('app profiles never store a credential');
  },
  decrypt: (): string => {
    throw new Error('app profiles never read a credential');
  },
};

/**
 * Every shape the installed add-ons define. A shape that does not parse is
 * left out (the add-on's own install refused it; here it is simply absent),
 * so a table built on it is skipped with "not a shape the add-on defines".
 */
export async function installedShapes(meta: MetaDb): Promise<InstalledShapes> {
  const byKey = new Map<string, ShapeDefinition>();
  const addOns = new Set<string>();
  for (const installed of await manifestsRepo(meta, NO_SECRETS).list('add-on')) {
    if (installed.row.status !== 'installed' && installed.row.status !== 'disabled') continue;
    addOns.add(installed.row.manifestKey);
    const shapes = (installed.document as { addOn?: { shapes?: unknown[] } } | null)?.addOn?.shapes ?? [];
    for (const candidate of shapes) {
      const parsed = shapeDefinitionSchema.safeParse(candidate);
      if (parsed.success) byKey.set(shapeKey(installed.row.manifestKey, parsed.data), parsed.data);
    }
  }
  return { byKey, addOns };
}

type AppTable = AppManifest['requiredSchema']['tables'][number];
type StatementBlock = NonNullable<AppDocument['statement']>;

/** A profile the manifest asks for, in the app's own table and column names. */
export interface PlannedProfile {
  addOn: string;
  kind: string;
  /** The app's table ref (`invoices`). */
  table: string;
  name: string;
  mapping: Record<string, ManifestSlotMapping>;
  statement?: StatementBlock | undefined;
  /** Where it came from: the shape the table is built on, the app's own entry, or both. */
  from: 'shape' | 'app' | 'shape+app';
}

export interface SkippedProfile {
  kind: string | null;
  table: string;
  reason: string;
}

/** A label or a text as one name: US English, else the first language given. */
function nameOf(text: AppDocument['name']): string {
  const name = typeof text === 'string' ? text : (text['en-US'] ?? Object.values(text)[0] ?? '');
  return name.slice(0, 120);
}

/**
 * The profiles the manifest asks for, against the installed shapes — pure,
 * so the install's check step can show them before anything is written.
 */
export function planAppProfiles(manifest: AppManifest, shapes: InstalledShapes): { planned: PlannedProfile[]; skipped: SkippedProfile[] } {
  const tables = manifest.requiredSchema.tables;
  const planned: PlannedProfile[] = [];
  const skipped: SkippedProfile[] = [];

  for (const table of tables) {
    if (table.builtOn === undefined || table.part === undefined) continue;
    const addOn = table.builtOn.split('/')[0]!;
    if (!shapes.addOns.has(addOn)) {
      skipped.push({ kind: null, table: table.ref, reason: `the "${addOn}" add-on is not installed, so the documents of "${table.builtOn}" are not made` });
      continue;
    }
    const shape = shapes.byKey.get(table.builtOn);
    if (shape === undefined) {
      skipped.push({ kind: null, table: table.ref, reason: `"${table.builtOn}" is not a shape the installed "${addOn}" add-on defines` });
      continue;
    }
    /** The app's table built on a part: `lines` in this shape, or `quote@1/document` in another of the add-on's. */
    const tableFor = (part: string): string | undefined => {
      const [key, name] = part.includes('/') ? [`${addOn}/${part.split('/')[0]!}`, part.split('/')[1]!] : [table.builtOn!, part];
      return tables.find((t) => t.builtOn === key && t.part === name)?.ref;
    };
    for (const profile of shape.documentProfiles ?? []) {
      if (profile.part !== table.part) continue;
      const mapping: Record<string, ManifestSlotMapping> = {};
      let missing: string | null = null;
      for (const [slot, source] of Object.entries(profile.mapping)) {
        if ('collection' in source) {
          const child = tableFor(source.collection.table);
          if (child === undefined) {
            missing = source.collection.table;
            break;
          }
          mapping[slot] = { collection: { ...source.collection, table: child } };
        } else {
          mapping[slot] = { ...source };
        }
      }
      let statement: StatementBlock | undefined;
      if (missing === null && profile.statement !== undefined) {
        const documents = tableFor(profile.statement.documents.table);
        const payments = tableFor(profile.statement.payments.table);
        if (documents === undefined || payments === undefined) missing = documents === undefined ? profile.statement.documents.table : profile.statement.payments.table;
        else statement = { documents: { ...profile.statement.documents, table: documents }, payments: { ...profile.statement.payments, table: payments } };
      }
      if (missing !== null) {
        skipped.push({ kind: profile.kind, table: table.ref, reason: `no table of the app is built on "${missing}" of "${table.builtOn}"` });
        continue;
      }
      planned.push({ addOn, kind: profile.kind, table: table.ref, name: nameOf(profile.name), mapping, ...(statement === undefined ? {} : { statement }), from: 'shape' });
    }
  }

  for (const entry of manifest.documents ?? []) {
    const extended = planned.find((p) => p.table === entry.table && p.kind === entry.kind && p.addOn === entry.addOn && p.from === 'shape');
    if (extended !== undefined) {
      extended.mapping = { ...extended.mapping, ...entry.mapping };
      extended.name = nameOf(entry.name);
      if (entry.statement !== undefined) extended.statement = entry.statement;
      extended.from = 'shape+app';
      continue;
    }
    if (!shapes.addOns.has(entry.addOn)) {
      skipped.push({ kind: entry.kind, table: entry.table, reason: `the "${entry.addOn}" add-on is not installed, so this document is not made` });
      continue;
    }
    planned.push({
      addOn: entry.addOn,
      kind: entry.kind,
      table: entry.table,
      name: nameOf(entry.name),
      mapping: { ...entry.mapping },
      ...(entry.statement === undefined ? {} : { statement: entry.statement }),
      from: 'app',
    });
  }
  return { planned, skipped };
}

/** A planned profile in the store's words: real table ids, the pipeline's slot mapping. */
export interface StoredProfile {
  addOnKey: string;
  kind: string;
  name: string;
  table: string;
  mapping: ProfileMapping;
  options: { numberColumn?: string; statement?: StatementSources };
  orderBy: string | null;
}

/**
 * Translate a planned profile to real names, or say why it cannot be.
 *
 * `realId` maps the app's table ref to the snapshot id of the table the
 * install made (`invoices` → `public.studio_invoices`), or null when there is
 * none. Columns keep their names: prefixing renames tables, never columns.
 */
export function storedProfile(
  plan: PlannedProfile,
  manifest: AppManifest,
  realId: (ref: string) => string | null,
): StoredProfile | { reason: string } {
  const tableOf = (ref: string): AppTable | undefined => manifest.requiredSchema.tables.find((t) => t.ref === ref);
  const own = tableOf(plan.table);
  const table = realId(plan.table);
  if (own === undefined || table === null) return { reason: `"${plan.table}" is not a table the install made` };

  const mapping: ProfileMapping = {};
  let orderBy: string | null = null;
  for (const [slot, source] of Object.entries(plan.mapping)) {
    if ('collection' in source) {
      const child = realId(source.collection.table);
      if (child === null) return { reason: `"${source.collection.table}" is not a table the install made` };
      const collection: SlotMapping = {
        collection: {
          table: child,
          fkColumn: source.collection.via,
          columns: { ...source.collection.columns },
          ...(source.collection.orderBy === undefined ? {} : { orderBy: source.collection.orderBy }),
        },
      };
      mapping[slot] = collection;
      orderBy ??= source.collection.orderBy ?? null;
    } else if ('via' in source) {
      const references = own.columns.find((column) => column.ref === source.via)?.references;
      const linked = references === undefined ? null : realId(references);
      if (linked === null) return { reason: `"${plan.table}.${source.via}" does not point at a table the install made` };
      mapping[slot] = { ref: source.via, column: source.column, table: linked };
    } else {
      mapping[slot] = { column: source.column };
    }
  }

  const options: StoredProfile['options'] = {};
  // A row numbered when it was made (a formatted number) carries the document's number.
  const numbered = own.columns.find((column) => (column.rules as { format?: unknown } | undefined)?.format !== undefined);
  if (numbered !== undefined) options.numberColumn = numbered.ref;
  if (plan.statement !== undefined) {
    const sourceOf = (s: StatementBlock['documents']): StatementSource | null => {
      const real = realId(s.table);
      if (real === null) return null;
      return {
        table: real,
        via: s.via,
        date: s.date,
        amount: s.amount,
        ...(s.number === undefined ? {} : { number: s.number }),
        ...(s.where === undefined ? {} : { where: { column: s.where.column, in: [...s.where.in] } }),
        ...(s.unless === undefined ? {} : { unless: s.unless }),
      };
    };
    const documents = sourceOf(plan.statement.documents);
    const payments = sourceOf(plan.statement.payments);
    if (documents === null || payments === null) return { reason: 'the statement names a table the install did not make' };
    options.statement = { documents, payments };
  }
  return { addOnKey: plan.addOn, kind: plan.kind, name: plan.name, table, mapping, options, orderBy };
}

export interface AppProfilesResult {
  made: { id: string; kind: string; table: string }[];
  updated: { id: string; kind: string; table: string }[];
  removed: string[];
  skipped: SkippedProfile[];
}

/** Options the app decides; an operator's own (locale, paper, formats…) are kept across an update. */
const APP_OPTIONS = ['numberColumn', 'statement'] as const;

/**
 * Make (install) or bring up to date (update) an app's document profiles on
 * one connection. Idempotent: running it twice with the same manifest changes
 * nothing the second time.
 */
export async function makeAppProfiles(input: {
  meta: MetaDb;
  manifest: AppManifest;
  connectionId: string;
  realId: (ref: string) => string | null;
  shapes: InstalledShapes;
  createdBy?: string | null | undefined;
  at?: number | undefined;
}): Promise<AppProfilesResult> {
  const at = input.at ?? Date.now();
  const repo = documentProfilesRepo(input.meta);
  const appKey = input.manifest.key;
  const { planned, skipped } = planAppProfiles(input.manifest, input.shapes);
  const result: AppProfilesResult = { made: [], updated: [], removed: [], skipped: [...skipped] };

  const owned = await repo.listOwnedBy(input.connectionId, appKey);
  const everyone = await repo.list({ connectionId: input.connectionId });
  const kept = new Set<string>();

  for (const plan of planned) {
    const stored = storedProfile(plan, input.manifest, input.realId);
    if ('reason' in stored) {
      result.skipped.push({ kind: plan.kind, table: plan.table, reason: stored.reason });
      continue;
    }
    const mine = owned.find((p) => p.table === stored.table && p.kind === stored.kind && p.addOnKey === stored.addOnKey);
    const clash = everyone.find(
      (p) => p.ownerApp !== appKey && p.addOnKey === stored.addOnKey && p.kind === stored.kind && p.table === stored.table && p.name === stored.name,
    );
    if (clash !== undefined) {
      result.skipped.push({ kind: plan.kind, table: plan.table, reason: `a profile named "${stored.name}" that is not the app's already draws this document` });
      if (mine !== undefined) kept.add(mine.id);
      continue;
    }
    if (mine !== undefined) {
      kept.add(mine.id);
      const options: Record<string, unknown> = { ...mine.options };
      for (const key of APP_OPTIONS) delete options[key];
      Object.assign(options, stored.options);
      await repo.patch(mine.id, { name: stored.name, mapping: stored.mapping as Record<string, unknown>, options, orderBy: stored.orderBy }, at);
      result.updated.push({ id: mine.id, kind: stored.kind, table: stored.table });
      continue;
    }
    const made = await repo.create(
      {
        addOnKey: stored.addOnKey,
        kind: stored.kind,
        name: stored.name,
        connectionId: input.connectionId,
        table: stored.table,
        mapping: stored.mapping as Record<string, unknown>,
        options: stored.options as Record<string, unknown>,
        createdBy: input.createdBy ?? null,
        ownerApp: appKey,
        orderBy: stored.orderBy,
      },
      at,
    );
    kept.add(made.id);
    result.made.push({ id: made.id, kind: stored.kind, table: stored.table });
  }

  /*
   * What the new version no longer asks for goes — but not one skipped for
   * an add-on or shape that is missing right now: that profile is still
   * asked for, and taking it away would lose the operator's own options on
   * it for a condition that may pass (the add-on is reinstalled).
   */
  const stillAsked = (profile: DocumentProfile): boolean =>
    result.skipped.some((skip) => {
      const real = input.realId(skip.table);
      return real === profile.table && (skip.kind === null || skip.kind === profile.kind);
    });
  for (const profile of owned) {
    if (kept.has(profile.id) || stillAsked(profile)) continue;
    await removeProfile(input.meta, profile);
    result.removed.push(profile.id);
  }
  return result;
}

/** One profile, and the rule of any trigger an operator gave it. */
async function removeProfile(meta: MetaDb, profile: DocumentProfile): Promise<void> {
  if (profile.trigger !== null) await syncProfileTrigger(meta, null, { previous: profile });
  await documentProfilesRepo(meta).remove(profile.id);
}

/**
 * The uninstall's half: every profile the app made on this connection, and
 * nothing else. The documents already issued stay in the register (their
 * profile reference empties); an operator's profiles are untouched.
 */
export async function removeAppProfiles(meta: MetaDb, connectionId: string, appKey: string): Promise<number> {
  const owned = await documentProfilesRepo(meta).listOwnedBy(connectionId, appKey);
  for (const profile of owned) {
    if (profile.trigger !== null) await syncProfileTrigger(meta, null, { previous: profile });
  }
  return await documentProfilesRepo(meta).removeOwnedBy(connectionId, appKey);
}
