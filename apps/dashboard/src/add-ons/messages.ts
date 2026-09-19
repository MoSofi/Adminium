// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's own strings, registered into the running i18n instance.
 *
 * An add-on page cannot use the host's message catalogue: its words are its
 * own, they ship in its package, and the engine has no business carrying 3,744
 * translated strings for a screen it does not host. So it hands them over here,
 * once, and gets back a translator already bound to them.
 *
 * ─── Why this returns a `t` instead of taking a namespace string ────────────
 *
 * Two add-ons will eventually both want to be called `documents`. If each
 * passed a namespace and then wrote `t('documents:title')` itself, the second
 * one silently reads the first one's words. So the CALLER never sees the
 * namespace: the host derives it (`addon.<key>`), registers under it, and
 * returns a function that prefixes every lookup. A collision becomes
 * impossible rather than unlikely.
 *
 * ─── Why `addResources` and not `addResourceBundle` ─────────────────────────
 *
 * The same reason the override layer uses it: `addResourceBundle`'s deep merge
 * cannot REMOVE a key, so a bundle registered twice — an upgrade in another
 * tab, a remount after a language switch — would keep whatever the older copy
 * had and nothing would say so. `addResources` writes the flat keys it is
 * given, which is what a re-register should mean.
 *
 * Every locale the add-on ships is registered at once. It is already holding
 * all of them in memory (they came in its bundle), and registering only the
 * active one would mean re-registering on every language switch — a listener
 * this seam would then have to own.
 */
import { getI18nInstance } from '../i18n/t.js';
import { t } from '../i18n/t.js';

/** Flat, dotted keys per locale tag: `{ 'de-DE': { 'manager.title': '…' } }`. */
export type AddOnMessageBundles = Readonly<Record<string, Readonly<Record<string, string>>>>;

export type BoundTranslate = (
  key: string,
  fallback: string,
  args?: Record<string, unknown>,
) => string;

/** The namespace an add-on's messages live under. Never chosen by the add-on. */
export function addOnNamespaceFor(addOnKey: string): string {
  return `addon.${addOnKey}`;
}

export function registerMessages(addOnKey: string, bundles: AddOnMessageBundles): BoundTranslate {
  const namespace = addOnNamespaceFor(addOnKey);
  const i18n = getI18nInstance();
  if (i18n !== null) {
    for (const [tag, flat] of Object.entries(bundles)) {
      if (Object.keys(flat).length === 0) continue;
      i18n.addResources(tag, namespace, flat);
    }
  }
  /*
   * With no instance at all — a unit test that never boots i18n — this still
   * answers, from the fallback the call site passes. That is the same promise
   * `t()` itself makes, and it is why an add-on page renders readable English
   * in a test harness rather than raw keys.
   */
  /*
   * The rule wants the marker on the line DIRECTLY above the call — it reads
   * comments ending on `line - 1`, so a reason five lines up does not count.
   * What the rule protects against — a key that renders as raw dots — is
   * covered here by the add-on's own eight-locale parity gate and by the
   * fallback every call site passes.
   */
  // i18n-dynamic-key: the key is an add-on's and the namespace is derived from its key, so neither half can be a literal here
  return (key, fallback, args) => t(`${namespace}:${key}`, fallback, args);
}
