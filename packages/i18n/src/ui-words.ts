// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words en-US does not ship in its eager bundles (`DEFERRED_GROUPS`,
 * ./resources/namespaces.ts): the widget and page-template words of `ui`, and
 * four screens' words of `common`. Each namespace's part is its own chunk,
 * merged into an instance's en-US copy the first time something needs it.
 * Every other locale loads these namespaces whole at init, so this is the
 * English — the active text for an en-US reader, the fallback behind
 * everyone else.
 *
 * Merged under what is already there (`overwrite: false`): an override an
 * admin wrote for one of these keys, applied at boot, stays. Once a chunk
 * has been read, every instance made afterwards (an override rebuild, a
 * second tab's) starts with it (`createI18n` asks {@link loadedWords}), so
 * nothing waits twice.
 */
// The i18next instance type, from i18next itself: create-i18n.ts reads this module, so it may not read create-i18n.
import type { i18n as I18nInstance } from 'i18next';
import { DEFERRED_GROUP_COUNTS } from './resources/deferred-counts.js';
import { DEFERRED_GROUPS, type ResourceBundle, type SplitNamespace } from './resources/namespaces.js';
import { bumpI18nRevision } from './revision.js';

const CHUNKS: Record<SplitNamespace, () => Promise<{ default: unknown }>> = {
  ui: () => import('./resources/en-us/ui-deferred.js'),
  common: () => import('./resources/en-us/common-deferred.js'),
};

const loaded: Partial<Record<SplitNamespace, ResourceBundle>> = {};
const pending = new WeakMap<I18nInstance, Partial<Record<SplitNamespace, Promise<void>>>>();
const complete = new WeakMap<I18nInstance, Set<SplitNamespace>>();

/** How many texts a tree holds. */
function leaves(node: unknown): number {
  if (typeof node === 'string') return 1;
  if (typeof node !== 'object' || node === null) return 0;
  let sum = 0;
  for (const child of Object.values(node)) sum += leaves(child);
  return sum;
}

/** The en-US words of a namespace's deferred groups, once their chunk has been read in this process. */
export function loadedWords(ns: SplitNamespace): ResourceBundle | null {
  return loaded[ns] ?? null;
}

/**
 * Whether this instance's en-US copy of `ns` carries its deferred groups,
 * whole. A group an override only started (one reworded key, applied at boot)
 * is not in: it is counted, not just looked for.
 */
export function hasWords(i18n: I18nInstance, ns: SplitNamespace): boolean {
  // A stand-in with no resource store (a test's) reads the whole catalogue already: nothing to load into it.
  if (typeof (i18n as Partial<I18nInstance>).getResource !== 'function') return true;
  if (complete.get(i18n)?.has(ns) === true) return true;
  const counts = DEFERRED_GROUP_COUNTS[ns] as Readonly<Record<string, number>>;
  const whole = DEFERRED_GROUPS[ns].every((group) => leaves(i18n.getResource('en-US', ns, group)) >= (counts[group] ?? 1));
  if (whole) complete.set(i18n, (complete.get(i18n) ?? new Set()).add(ns));
  return whole;
}

/**
 * Resolves once the instance's en-US copy of `ns` carries its deferred
 * groups. Memoised per instance and namespace (usable with React's `use()`);
 * never rejects — a chunk that will not load leaves every call site on its
 * inline English.
 */
export function wordsReady(i18n: I18nInstance, ns: SplitNamespace): Promise<void> {
  if (hasWords(i18n, ns)) return Promise.resolve();
  let mine = pending.get(i18n);
  if (mine === undefined) {
    mine = {};
    pending.set(i18n, mine);
  }
  let promise = mine[ns];
  if (promise === undefined) {
    promise = CHUNKS[ns]()
      .then((module) => {
        const words = module.default as ResourceBundle;
        loaded[ns] = words;
        if (!hasWords(i18n, ns)) {
          // A copy: the store must never hold (and an override never rewrite) the module's own object.
          i18n.addResourceBundle('en-US', ns, structuredClone(words), true, false);
          complete.set(i18n, (complete.get(i18n) ?? new Set()).add(ns));
          bumpI18nRevision();
        }
      })
      .catch(() => undefined);
    mine[ns] = promise;
  }
  return promise;
}

/** The en-US widget and template words, once their chunk has been read in this process. */
export const loadedUiWords = (): ResourceBundle | null => loadedWords('ui');
/** Whether this instance's en-US `ui` carries the widget and template words. */
export const hasUiWords = (i18n: I18nInstance): boolean => hasWords(i18n, 'ui');
/** Resolves once the instance's en-US `ui` carries the widget and template words. */
export const uiWordsReady = (i18n: I18nInstance): Promise<void> => wordsReady(i18n, 'ui');
