// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Loading a DEFERRED message namespace before its surface renders
 * (10-i18n-theming.md §2.3; `DEFERRED_NAMESPACES`). `studio` was the first
 * (10-T06); `email` the second (39-email-templates-and-campaigns.md §6.1) —
 * the same choreography, so it lives once here and each surface exports a
 * one-line `…MessagesReady()` over it.
 *
 * Resolves once the namespace is in the store for the active language and
 * the en-US fallback behind it, with any overrides applied. Safe to call on
 * every render — the promise is memoised per instance and namespace, which
 * is also what makes it usable with `use()`.
 *
 * With no instance at all (unit tests that never boot i18n) this resolves
 * immediately: those render from the inline fallbacks by design.
 */
import { localeFromTag, type DeferredNamespace } from '@adminium/i18n';

import { fetchBundle } from '../api/i18nBoot.js';
import { getI18nInstance, type I18nInstance } from './t.js';

const ALREADY: Promise<void> = Promise.resolve();

const inFlight = new WeakMap<I18nInstance, Map<DeferredNamespace, Promise<void>>>();

async function overridesFor(tag: string, ns: DeferredNamespace): Promise<{ tag: string; overrides: Record<string, string> }[]> {
  const ids = new Set([localeFromTag(tag), 'en_US']);
  return Promise.all(
    [...ids].map(async (id) => {
      const bundle = await fetchBundle(id, ns);
      return { tag: id.replaceAll('_', '-'), overrides: bundle.overrides };
    }),
  );
}

export function deferredMessagesReady(ns: DeferredNamespace): Promise<void> {
  const i18n = getI18nInstance();
  if (i18n === null) return ALREADY;

  let perNamespace = inFlight.get(i18n);
  if (perNamespace === undefined) {
    perNamespace = new Map();
    inFlight.set(i18n, perNamespace);
  }
  const pending = perNamespace.get(ns);
  if (pending !== undefined) return pending;

  const promise = (async () => {
    // Both requests in flight together; the compiled bundle is APPLIED first
    // regardless, because `addResources` below runs after this await. That
    // ordering is the whole reason the overrides are not merged through
    // `loadBundle`: a compiled chunk landing late must not overwrite them.
    //
    // `loadNamespaces` also appends the namespace to `options.ns`, which is
    // what makes a LATER `switchLocale` fetch the new language's copy — the
    // locale picker never learns about namespaces it was not told to carry.
    const [, overrides] = await Promise.all([
      i18n.loadNamespaces(ns),
      // Signed out, offline, or a build without the route: compiled text is a
      // correct render, just not a customised one (the same call setup.ts's
      // `refreshOverrides` makes for the eager namespaces).
      overridesFor(i18n.language, ns).catch(() => []),
    ]);
    for (const { tag, overrides: flat } of overrides) {
      if (Object.keys(flat).length === 0) continue;
      // Flat dotted keys — `addResources` nests them on `keySeparator`.
      i18n.addResources(tag, ns, flat);
    }
  })()
    // Degraded network beats a blank screen (10 §7.5), and this promise is
    // consumed by `use()` — a rejection would surface as an error boundary
    // over the whole surface instead of a page rendered from its own inline
    // English. The same shape as the lazy backend's own failure path.
    .catch(() => undefined);

  perNamespace.set(ns, promise);
  return promise;
}
