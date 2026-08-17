// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The flattened en-US key surface (23-runtime-translations.md §6.1).
 *
 * The Translations editor has to let an admin find one message among ~2,800,
 * and the server has to answer "is this a real key?" on every write. Both run
 * against THIS index, in process, so the DB is only ever asked for an
 * `(namespace, key) IN (…)` slice — never a portable `LIKE '%q%'` scan over a
 * table that grows with every override.
 *
 * Built lazily and cached: a server that never opens the editor never pays
 * for it.
 */

import { EN_US_RESOURCES, NAMESPACES, type Namespace, type ResourceBundle } from './resources/index.js';

/** Nested bundle → flat `dot.path` → message. */
export function flattenBundle(
  bundle: ResourceBundle,
  prefix = '',
  out = new Map<string, string>(),
): Map<string, string> {
  for (const [key, value] of Object.entries(bundle)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out.set(path, value);
    else flattenBundle(value, path, out);
  }
  return out;
}

/** Flat map → nested bundle, the shape i18next's resource store wants. */
export function nestBundle(flat: ReadonlyMap<string, string>): ResourceBundle {
  const root: Record<string, unknown> = {};
  for (const [path, value] of flat) {
    const parts = path.split('.');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i] as string;
      const next = node[part];
      if (typeof next !== 'object' || next === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1] as string] = value;
  }
  return root as ResourceBundle;
}

let index: ReadonlyMap<Namespace, ReadonlyMap<string, string>> | null = null;

/** `namespace → key → en-US source text`, built once per process. */
export function sourceIndex(): ReadonlyMap<Namespace, ReadonlyMap<string, string>> {
  if (index === null) {
    const built = new Map<Namespace, ReadonlyMap<string, string>>();
    for (const ns of NAMESPACES) built.set(ns, flattenBundle(EN_US_RESOURCES[ns]));
    index = built;
  }
  return index;
}

/** The en-US source for a key, or `null` when the key does not exist. */
export function sourceMessage(namespace: string, key: string): string | null {
  const ns = sourceIndex().get(namespace as Namespace);
  return ns?.get(key) ?? null;
}

/** Total number of authored keys across every namespace. */
export function sourceKeyCount(): number {
  let total = 0;
  for (const ns of sourceIndex().values()) total += ns.size;
  return total;
}

/**
 * The first segment of a key (`widgets.charts.foo` → `widgets`).
 *
 * The editor groups by this rather than by namespace, because the namespace
 * axis is badly unbalanced in practice — `common` and `ui` hold effectively
 * every key while `studio` and `generated` hold a handful each — so namespace
 * is a poor primary navigation and a fine secondary filter.
 */
export function keyGroup(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}
