// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's parts at install: which are left out, and what is stored of them.
 *
 * A part whose tables are built on an add-on's shape is left out of the
 * install while that add-on is not connected to the app (`modules.ts` in the
 * manifest package). The manifest an install, an update and a plan work from
 * is therefore the app's manifest AS IT STANDS HERE, cut by
 * {@link asInstalledHere}; that is also the document stored for the app, so
 * everything that reads it sees the tables that exist and no others. When the
 * add-on arrives, the app is applied again from its package and the part is
 * put in.
 */
import { columnsLeftOut, modulesLeftOut, tablesLeftOut, withoutModules, type Manifest } from '@adminium/manifest';
import type { AppModules } from '@adminium/meta';

import type { AppAddOnRow } from './add-ons.js';
import { planPublicEndpoints } from './manifest-public.js';

/**
 * The add-ons that are there for the app once this install has run: the ones
 * connected to it already, the ones it requires, and the ones chosen with it.
 */
export function addOnsHereFor(rows: readonly AppAddOnRow[], chosen: readonly string[]): Set<string> {
  return new Set([...rows.filter((row) => row.state === 'attached' || row.need === 'requires').map((row) => row.key), ...chosen]);
}

/** The add-ons an install ticks when nobody says otherwise: what the check step shows ticked. */
export function tickedByDefault(rows: readonly AppAddOnRow[]): string[] {
  return rows.filter((row) => row.checked && row.action !== null && row.problems.length === 0 && row.state !== 'unavailable').map((row) => row.key);
}

/**
 * The parts of `manifest` that are left out with these add-ons there. Never a
 * part this install already has a table of (`made`, by table ref): a part
 * that was put in stays in when its add-on is later switched off for the app —
 * it is then off, not gone, and an update of the app takes nothing of it away.
 */
export function partsLeftOut(manifest: Manifest, here: ReadonlySet<string>, made: ReadonlySet<string> = new Set()): string[] {
  if (manifest.kind !== 'app') return [];
  return modulesLeftOut(manifest, (addOn) => here.has(addOn)).filter((module) => !tablesLeftOut(manifest, [module]).some((ref) => made.has(ref)));
}

/**
 * The manifest as it is installed with these add-ons there: its parts that
 * cannot be made are left out. What was left out rides along (not a key of
 * the manifest: it is not stored with it), for {@link modulesFor} to keep.
 */
export function asInstalledHere<M extends Manifest>(manifest: M, here: ReadonlySet<string>, made: ReadonlySet<string> = new Set()): M {
  const gone = partsLeftOut(manifest, here, made);
  if (gone.length === 0) return manifest;
  const cut = withoutModules(manifest, gone);
  LEFT_OUT.set(cut, { modules: gone, tables: tablesLeftOut(manifest, gone), columns: columnsLeftOut(manifest, gone) });
  return cut;
}

const LEFT_OUT = new WeakMap<object, NonNullable<AppModules['leftOut']>>();

/**
 * What is stored of an app's parts: each with its default and the add-ons its
 * feature needs, and the owner's switches. A switch set before is kept; a
 * pick of this install stands over it; a part the manifest no longer has, or
 * one that is `always`, keeps none.
 */
export function modulesFor(manifest: Manifest, prior: AppModules | null, picks?: Readonly<Record<string, boolean>>, names: Readonly<Record<string, string>> = {}): AppModules | null {
  if (manifest.kind !== 'app' || manifest.modules === undefined) return null;
  const needs = new Map((manifest.addOns?.features ?? []).map((feature) => [feature.id, feature.requires]));
  const defs = manifest.modules.map((module) => ({ id: module.id, default: module.default, needs: [...(module.feature === undefined ? [] : (needs.get(module.feature) ?? []))] }));
  const on: Record<string, boolean> = {};
  for (const def of defs) {
    if (def.default === 'always') continue;
    const value = picks?.[def.id] ?? prior?.on[def.id];
    if (value !== undefined) on[def.id] = value;
  }
  // Its public entries by the ref each is served under, in the manifest's order.
  const entries = manifest.publicAccess ?? [];
  const planned = entries.some((entry) => entry.module !== undefined) ? planPublicEndpoints(manifest, names, null, { tablesMadeLater: true }) : [];
  const doors = Object.fromEntries(planned.length === entries.length ? entries.flatMap((entry, index) => (entry.module === undefined ? [] : [[planned[index]!.ref, entry.module] as const])) : []);
  const leftOut = LEFT_OUT.get(manifest);
  return { defs, on, ...(Object.keys(doors).length === 0 ? {} : { doors }), ...(leftOut === undefined ? {} : { leftOut }) };
}

/** The picks that name no switchable part of the manifest: refused, never dropped silently. */
export function unknownPicks(manifest: Manifest, picks: Readonly<Record<string, boolean>> | undefined): string[] {
  if (picks === undefined) return [];
  const switchable = new Set((manifest.kind === 'app' ? (manifest.modules ?? []) : []).filter((module) => module.default !== 'always').map((module) => module.id));
  return Object.keys(picks).filter((id) => !switchable.has(id));
}

/** One part of an app as a check step or the app's page shows it. */
export interface PlanModule {
  id: string;
  label: Record<string, string>;
  default: 'on' | 'off' | 'always';
  on?: boolean;
  needs: string[];
  leftOut: boolean;
  tables: string[];
  roles: string[];
  /** How many of the app's rules are of this part: made with it, and run while it is on. */
  rules: number;
}

/**
 * What the check counts beside the parts: the app's roles, each with the
 * parts it is of (none: it is offered whatever is on), and how many of its
 * rules are of no part. With the parts' own counts, the check works out "N
 * tables, N roles, N rules" and the roles left with nothing to open.
 */
export interface PlanWhole {
  roles: { name: string; parts: string[] }[];
  rules: number;
}

/** The roles and the rules of no part of an app with parts, for the check step. */
export function planWholeOf(declared: Manifest): PlanWhole | undefined {
  if (declared.kind !== 'app' || declared.modules === undefined) return undefined;
  const ids = new Set(declared.modules.map((module) => module.id));
  return {
    roles: (declared.roles ?? []).map((role) => ({ name: role.name, parts: (role.modules ?? []).filter((id) => ids.has(id)) })),
    rules: (declared.automations ?? []).filter((rule) => rule.module === undefined || !ids.has(rule.module)).length,
  };
}

/** The parts of `declared` (the app's whole manifest) for a check step: `leftOut` are the ones this install does not make. */
export function planModulesOf(declared: Manifest, leftOut: readonly string[], stored: AppModules | null): PlanModule[] {
  if (declared.kind !== 'app') return [];
  const needs = new Map((declared.addOns?.features ?? []).map((feature) => [feature.id, feature.requires]));
  return (declared.modules ?? []).map((module) => ({
    id: module.id,
    label: { ...module.label },
    default: module.default,
    ...(stored === null || module.default === 'always' ? {} : { on: stored.on[module.id] ?? module.default === 'on' }),
    needs: [...(module.feature === undefined ? [] : (needs.get(module.feature) ?? []))],
    leftOut: leftOut.includes(module.id),
    tables: (declared.requiredSchema?.tables ?? []).filter((table) => 'module' in table && table.module === module.id).map((table) => table.ref),
    roles: (declared.roles ?? []).filter((role) => role.modules?.includes(module.id) === true).map((role) => role.name),
    rules: (declared.automations ?? []).filter((rule) => rule.module === module.id).length,
  }));
}
