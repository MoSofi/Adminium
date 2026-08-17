// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Runtime override layer (23-runtime-translations.md §4.3).
 *
 * The compiled bundle and the DB override tree are held SEPARATELY and merged
 * in userland; the i18next resource store is written once, at `init`, and
 * never mutated afterwards. Two facts about i18next 25 force that shape, and
 * both were verified against its source rather than assumed:
 *
 *  1. `addResourceBundle` cannot DELETE a key — its `deepExtend` only ever
 *     writes keys present in the incoming object. So the store cannot express
 *     "reset this key to the built-in", which is the single most common admin
 *     operation. And `removeResourceBundle` is not an escape: it calls
 *     `removeNamespaces`, which splices the namespace out of `options.ns` for
 *     the WHOLE instance, breaking en-US resolution and every future backend
 *     load for that namespace.
 *  2. The backend loader fires at most once per (language, namespace) per
 *     instance — `queueLoad` short-circuits on `hasResourceBundle` — so
 *     merging inside `loadBundle` is a first-load mechanism, not a
 *     steady-state one.
 *
 * Therefore: merge at load, and REBUILD the instance on every version bump,
 * swapping it in through the existing provider seam. That is the only
 * operation this i18next version performs losslessly.
 */

import { createI18n, type CreateI18nOptions, type I18nInstance } from './create-i18n.js';
import { tagForLocale, type LocaleId } from './locales.js';
import { bumpI18nRevision } from './revision.js';
import type { Namespace, ResourceBundle } from './resources/index.js';

/** `tag → namespace → flat dotted key → message`. Sparse: only overrides. */
export type OverrideMap = Readonly<
  Record<string, Readonly<Partial<Record<Namespace, Readonly<Record<string, string>>>>>>
>;

/**
 * Merge flat dotted overrides into a (cloned) nested bundle.
 *
 * An empty-string value is written through deliberately — it is the third
 * state, "render nothing" (23 §3.3), and is why `createI18n` sets
 * `returnEmptyString: true`.
 */
export function mergeOverrides(
  base: ResourceBundle | null,
  flat: Readonly<Record<string, string>>,
): ResourceBundle {
  const root: Record<string, unknown> =
    base === null ? {} : (structuredClone(base) as Record<string, unknown>);
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i] as string;
      const next = node[part];
      // A key may override a leaf that used to be a subtree (or vice versa);
      // replace rather than crash.
      if (typeof next !== 'object' || next === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1] as string] = value;
  }
  return root as ResourceBundle;
}

export interface CreateI18nWithOverridesOptions extends CreateI18nOptions {
  /** DB-sourced overrides, keyed by BCP-47 tag. */
  overrides?: OverrideMap | undefined;
}

/**
 * `createI18n` with the override layer folded in.
 *
 * en-US overrides are applied through the SAME merge as every other locale,
 * never through `createI18n`'s `resources` option: that option does
 * `target[ns] = bundle`, a whole-namespace REPLACEMENT, so routing a sparse
 * override tree through it would delete the ~1,500 other `common` keys.
 */
export async function createI18nWithOverrides(
  opts: CreateI18nWithOverridesOptions,
): Promise<I18nInstance> {
  const { overrides, loadBundle, resources, ...rest } = opts;
  if (overrides === undefined || Object.keys(overrides).length === 0) {
    return createI18n(opts);
  }

  const enUsOverrides = overrides['en-US'];
  const mergedEnUs: Partial<Record<Namespace, ResourceBundle>> = {};
  if (enUsOverrides !== undefined) {
    const { EN_US_RESOURCES } = await import('./resources/index.js');
    for (const [ns, flat] of Object.entries(enUsOverrides)) {
      if (flat === undefined) continue;
      mergedEnUs[ns as Namespace] = mergeOverrides(EN_US_RESOURCES[ns as Namespace], flat);
    }
  }

  return createI18n({
    ...rest,
    resources: {
      ...resources,
      // Full merged namespaces, so the whole-namespace replacement is safe.
      ...(Object.keys(mergedEnUs).length > 0 ? { 'en-US': mergedEnUs } : {}),
    },
    loadBundle: async (tag, ns) => {
      const base = loadBundle === undefined ? null : await loadBundle(tag, ns);
      const flat = overrides[tag]?.[ns];
      const baseBundle =
        base === null ? null : 'default' in base ? (base as { default: ResourceBundle }).default : base;
      if (flat === undefined) return baseBundle;
      // Merged HERE rather than after the fact, so a slow compiled chunk
      // landing later can never clobber an override that was already applied.
      return { default: mergeOverrides(baseBundle, flat) };
    },
  });
}

/**
 * Rebuild the instance with a new override set and hand it back.
 *
 * The caller swaps the result into whatever holds the active instance and
 * calls `bumpI18nRevision()` — which this does for you — so subscribers
 * re-render. Rebuilding rather than patching is the whole point: see the
 * module header.
 */
export async function rebuildWithOverrides(
  opts: CreateI18nWithOverridesOptions,
): Promise<I18nInstance> {
  const instance = await createI18nWithOverrides(opts);
  bumpI18nRevision();
  return instance;
}

/** The BCP-47 key an override map uses for a locale id. */
export function overrideTag(locale: LocaleId): string {
  return tagForLocale(locale);
}
