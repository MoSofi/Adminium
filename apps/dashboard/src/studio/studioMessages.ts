// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Studio's half of the deferred-namespace contract (10-T06).
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
import { localeFromTag } from '@adminium/i18n';

import { fetchBundle } from '../api/i18nBoot.js';
import { getI18nInstance, type I18nInstance } from '../i18n/t.js';

const ALREADY: Promise<void> = Promise.resolve();

const inFlight = new WeakMap<I18nInstance, Promise<void>>();

/** This locale's Studio overrides, plus en-US's — the layer behind it. */
async function studioOverrides(tag: string): Promise<{ tag: string; overrides: Record<string, string> }[]> {
  const ids = new Set([localeFromTag(tag), 'en_US']);
  return Promise.all(
    [...ids].map(async (id) => {
      const bundle = await fetchBundle(id, 'studio');
      return { tag: id.replaceAll('_', '-'), overrides: bundle.overrides };
    }),
  );
}

/**
 * Resolves once `studio` is in the store for the active language and the
 * en-US fallback behind it, with any overrides applied. Safe to call on every
 * render — the promise is memoised per instance, which is also what makes it
 * usable with `use()`.
 *
 * With no instance at all (unit tests that never boot i18n) this resolves
 * immediately: those render from the inline fallbacks by design, exactly as
 * they did before the namespace moved.
 */
export function studioMessagesReady(): Promise<void> {
  const i18n = getI18nInstance();
  if (i18n === null) return ALREADY;

  const pending = inFlight.get(i18n);
  if (pending !== undefined) return pending;

  const promise = (async () => {
    // Both requests in flight together; the compiled bundle is APPLIED first
    // regardless, because `addResources` below runs after this await. That
    // ordering is the whole reason the overrides are not merged through
    // `loadBundle`: a compiled chunk landing late must not overwrite them.
    //
    // `loadNamespaces` also appends `studio` to `options.ns`, which is what
    // makes a LATER `switchLocale` fetch the new language's copy — the locale
    // picker never learns about namespaces it was not told to carry.
    const [, overrides] = await Promise.all([
      i18n.loadNamespaces('studio'),
      // Signed out, offline, or a build without the route: compiled text is a
      // correct render, just not a customised one (the same call setup.ts's
      // `refreshOverrides` makes for the eager namespaces).
      studioOverrides(i18n.language).catch(() => []),
    ]);
    for (const { tag, overrides: flat } of overrides) {
      if (Object.keys(flat).length === 0) continue;
      // Flat dotted keys — `addResources` nests them on `keySeparator`.
      i18n.addResources(tag, 'studio', flat);
    }
  })()
    // Degraded network beats a blank screen (10 §7.5), and this promise is
    // consumed by `use()` — a rejection would surface as an error boundary
    // over the whole console instead of a page rendered from its own inline
    // English. The same shape as the lazy backend's own failure path.
    .catch(() => undefined);

  inFlight.set(i18n, promise);
  return promise;
}
