// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The widget and page-template words (`ui.widgets.*`, `ui.templates.*`),
 * which en-US does not ship in its eager `ui` bundle (`UI_DEFERRED_GROUPS`,
 * ./resources/namespaces.ts): their own chunk, merged into an instance's
 * en-US `ui` the first time a widget needs them. Every other locale's `ui`
 * loads whole at init, so this is the English — the active text for an
 * en-US reader, the fallback behind everyone else.
 *
 * Merged under what is already there (`overwrite: false`): an override an
 * admin wrote for one of these keys, applied at boot, stays. Once the chunk
 * has been read, every instance made afterwards (an override rebuild, a
 * second tab's) starts with it (`createI18n` asks {@link loadedUiWords}),
 * so a widget never waits twice.
 */
// The i18next instance type, from i18next itself: create-i18n.ts reads this module, so it may not read create-i18n.
import type { i18n as I18nInstance } from 'i18next';
import { UI_DEFERRED_GROUPS, type ResourceBundle } from './resources/namespaces.js';
import { bumpI18nRevision } from './revision.js';

let loaded: ResourceBundle | null = null;
const pending = new WeakMap<I18nInstance, Promise<void>>();

/** The en-US widget and template words, once their chunk has been read in this process. */
export function loadedUiWords(): ResourceBundle | null {
  return loaded;
}

/** Whether this instance's en-US `ui` carries the widget and template words. */
export function hasUiWords(i18n: I18nInstance): boolean {
  // A stand-in with no resource store (a test's) reads the whole catalogue already: nothing to load into it.
  if (typeof (i18n as Partial<I18nInstance>).getResource !== 'function') return true;
  return UI_DEFERRED_GROUPS.every((group) => i18n.getResource('en-US', 'ui', group) !== undefined);
}

/**
 * Resolves once the instance's en-US `ui` carries the widget and template
 * words. Memoised per instance (usable with React's `use()`); never rejects —
 * a chunk that will not load leaves every call site on its inline English,
 * which is the same text.
 */
export function uiWordsReady(i18n: I18nInstance): Promise<void> {
  if (hasUiWords(i18n)) return Promise.resolve();
  let promise = pending.get(i18n);
  if (promise === undefined) {
    promise = import('./resources/en-us/ui-deferred.js')
      .then((module) => {
        loaded = module.default as ResourceBundle;
        if (!hasUiWords(i18n)) {
          // A copy: the store must never hold (and an override never rewrite) the module's own object.
          i18n.addResourceBundle('en-US', 'ui', structuredClone(loaded), true, false);
          bumpI18nRevision();
        }
      })
      .catch(() => undefined);
    pending.set(i18n, promise);
  }
  return promise;
}
