// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Studio's half of the deferred-namespace contract.
 *
 * `studio` is the one namespace @adminium/i18n does not bundle or preload for
 * anybody — 975 messages, ~36 KiB of the en-US catalogue, for a console behind
 * a role gate that most users never pass. The trade is that the namespace is
 * absent until its owner asks for it, and the owner has to ask BEFORE it
 * renders: `t('studio:…', fallback)` on an unloaded namespace returns the
 * inline fallback, which is the right English but is neither the admin's
 * override nor anybody's translation, and in DEV it also trips the missing-key
 * warning that `apps/e2e` fails a test on.
 *
 * So this is awaited (through `use()`, so the route's existing spinner covers
 * it) rather than kicked off and hoped for. `StudioBody` in ./routes.tsx is
 * the single place that does it, and every Studio surface goes through it.
 *
 * ─── The overrides come with it ────────────────────────────────────────────
 *
 * The boot path fetches override rows for the EAGER namespaces only
 * (`api/i18nBoot.ts`), which was right when every Studio key lived in `common`
 * and rode along with them. Now that they are their own namespace, an admin's
 * rewording would arrive for no Studio key at all unless something asked for
 * it — a silent regression of a shipped feature, on the one surface whose
 * users are the people who did the rewording. It is fetched here, alongside
 * the compiled bundle, so the two halves of a deferred namespace stay one
 * thing.
 *
 * Patching the store with `addResources` is safe HERE and nowhere else. The
 * override layer rebuilds the instance rather than patching it (setup.ts) for
 * a good reason — `addResourceBundle` cannot remove a key, so a patch-based
 * design cannot express "reset to built-in". This never patches the same
 * instance twice: each rebuild produces an instance this module has not seen,
 * and it loads that one from a freshly fetched set. A reset override is simply
 * absent from that set, and the compiled text stands.
 *
 * ─── Keyed on the instance, not the module ─────────────────────────────────
 *
 * Those rebuilds are exactly why. `refreshOverrides` / `resyncOverrides` both
 * call `setI18nInstance`, and the first runs on every boot. A module-level
 * `let loaded = true` would report the namespace present on a fresh instance
 * that has never loaded it, and the console would render fallbacks for the
 * rest of the session.
 */
import { uiWordsReady } from '@adminium/i18n';

import { deferredMessagesReady } from '../i18n/deferredMessages.js';
import { getI18nInstance, type I18nInstance } from '../i18n/t.js';

/**
 * Resolves once `studio` is in the store for the active language and the
 * en-US fallback behind it, with any overrides applied — the shared deferred
 * loader (`i18n/deferredMessages.ts`), which `email` uses the same way.
 */
/*
 * And the widget and template words, which en-US loads on demand
 * (`UI_DEFERRED_GROUPS`): the page editor names one outside a widget (the
 * records page's "New row" placeholder), where nothing else waits for them.
 * One promise per instance, so `use()` sees the same one on every render.
 */
const withUiWords = new WeakMap<I18nInstance, Promise<void>>();

export function studioMessagesReady(): Promise<void> {
  const i18n = getI18nInstance();
  if (i18n === null) return deferredMessagesReady('studio');
  let ready = withUiWords.get(i18n);
  if (ready === undefined) {
    ready = Promise.all([deferredMessagesReady('studio'), uiWordsReady(i18n)]).then(() => undefined);
    withUiWords.set(i18n, ready);
  }
  return ready;
}
