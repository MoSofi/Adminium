// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's tables built on an add-on's shape, checked against the add-on the
 * install will really run on.
 *
 * An app says `"builtOn": "invoices/invoice@1", "part": "document"` and
 * spells out the part's columns and rules beside its own; its own CI checks
 * them against a vendored copy of the shape. Here they are checked against the
 * INSTALLED add-on's shape at that version — or, when the add-on comes with
 * the app, the version the install will put in (the plan's add-on rows): a
 * column dropped or retyped, a rule changed, is `SHAPE_MISMATCH` naming the
 * column, before anything is written.
 *
 * The version is PINNED by the app: `invoice@1` is checked against the
 * add-on's `invoice@1`, whatever else a newer add-on ships beside it, and
 * only an app update moves it. An add-on upgrade never alters an app's
 * tables, and one that drops a shape version an installed app is built on
 * is refused (`add-ons/install.ts`).
 *
 * The table itself is the app's: its prefix, its name, its record, its pages,
 * sample data and uninstall — two apps built on one shape get two tables.
 * What the record adds is which part it is built on and the columns the
 * shape owns, for the inspector and the documents.
 */
import {
  shapeConformanceIssues,
  shapeDefinitionSchema,
  shapeKey,
  type Manifest,
  type ShapeDefinition,
} from '@adminium/manifest';
import { manifestsRepo } from '@adminium/meta';

import type { AddOnInstallerDeps } from '../add-ons/install.js';
import type { AppAddOnRow } from './add-ons.js';

/** The shapes the install will run on, by `<addOn>/<name>@<version>`, and the add-ons they could be read from. */
export interface PlanShapes {
  byKey: Map<string, ShapeDefinition>;
  /** Add-ons whose manifest was found (installed, or the staged version the install brings). */
  resolved: Set<string>;
}

/** The tables of `manifest` built on a shape. */
export function builtOnTables(manifest: Manifest): { ref: string; builtOn: string; part: string }[] {
  if (manifest.kind !== 'app') return [];
  return (manifest.requiredSchema?.tables ?? []).flatMap((table) =>
    table.builtOn === undefined || table.part === undefined ? [] : [{ ref: table.ref, builtOn: table.builtOn, part: table.part }],
  );
}

/** The shapes an add-on manifest document defines, parsed; one that does not parse is left out. */
export function shapesOfDocument(addOn: string, document: unknown): Map<string, ShapeDefinition> {
  const out = new Map<string, ShapeDefinition>();
  const shapes = (document as { addOn?: { shapes?: unknown[] } } | null)?.addOn?.shapes ?? [];
  for (const candidate of shapes) {
    const parsed = shapeDefinitionSchema.safeParse(candidate);
    if (parsed.success) out.set(shapeKey(addOn, parsed.data), parsed.data);
  }
  return out;
}

/**
 * The shapes of the add-ons `manifest` builds on, as the install will have
 * them: the staged version an install or an update brings, else the installed
 * one. An add-on neither here nor coming is not resolved — its own refusal
 * (`ADD_ON_REQUIRED`) says why.
 */
export async function shapesForPlan(
  installer: Pick<AddOnInstallerDeps, 'meta' | 'store' | 'credentialCrypto'> | undefined,
  manifest: Manifest,
  rows: readonly AppAddOnRow[],
): Promise<PlanShapes> {
  const out: PlanShapes = { byKey: new Map(), resolved: new Set() };
  if (installer === undefined) return out;
  const addOns = new Set(builtOnTables(manifest).map((table) => table.builtOn.split('/')[0]!));
  const manifests = manifestsRepo(installer.meta, installer.credentialCrypto);
  for (const key of addOns) {
    const row = rows.find((candidate) => candidate.key === key);
    let document: unknown = null;
    if (row !== undefined && (row.action === 'install' || row.action === 'update') && row.staged && row.offeredVersion !== null) {
      try {
        document = JSON.parse((await installer.store.readFile(key, row.offeredVersion, 'manifest.json')).toString('utf8'));
      } catch {
        document = null;
      }
    } else {
      const installed = await manifests.findByKey(key);
      if (installed !== null && installed.row.kind === 'add-on') document = installed.document;
    }
    if (document === null) continue;
    out.resolved.add(key);
    for (const [shape, definition] of shapesOfDocument(key, document)) out.byKey.set(shape, definition);
  }
  return out;
}

/** A shape refusal, as a plan problem: the app's table it is about, and a sentence naming the column. */
export interface ShapeProblem {
  code: 'SHAPE_MISMATCH' | 'SHAPE_UNKNOWN';
  table: string;
  message: string;
}

/**
 * How the app's tables differ from the shapes they are built on. A table
 * whose add-on could not be read is left to that add-on's own refusal.
 */
export function shapeProblems(manifest: Manifest, shapes: PlanShapes): ShapeProblem[] {
  if (manifest.kind !== 'app') return [];
  const tables = manifest.requiredSchema?.tables ?? [];
  return shapeConformanceIssues(manifest as never, shapes.byKey).flatMap((issue): ShapeProblem[] => {
    const index = /^requiredSchema\.tables\.(\d+)/.exec(issue.path);
    const table = index === null ? undefined : tables[Number(index[1])];
    const addOn = table?.builtOn?.split('/')[0];
    if (issue.code === 'SHAPE_UNKNOWN' && (addOn === undefined || !shapes.resolved.has(addOn))) return [];
    return [
      {
        code: issue.code,
        table: table?.ref ?? 'outbox',
        message: issue.code === 'SHAPE_UNKNOWN' ? `${issue.message}: the version the app is built on is not there.` : `${issue.message}.`,
      },
    ];
  });
}

/** What the table record keeps of a table built on a shape: the part, and the columns the shape owns. */
export function shapeRecordsFor(manifest: Manifest, shapes: PlanShapes): Map<string, { builtOn: string; shapeColumns: string[] }> {
  const out = new Map<string, { builtOn: string; shapeColumns: string[] }>();
  for (const table of builtOnTables(manifest)) {
    const part = shapes.byKey.get(table.builtOn)?.parts[table.part];
    if (part === undefined) continue;
    out.set(table.ref, { builtOn: `${table.builtOn}#${table.part}`, shapeColumns: part.columns.map((column) => column.ref) });
  }
  return out;
}
