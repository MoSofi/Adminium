// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The product's own words, in the language a sweep runs in.
 *
 * An accessibility sweep in Arabic cannot find "Install an app": the button
 * says it in Arabic. Hard-coding the Arabic here would be a second copy of the
 * translation that nothing keeps in step, so a sweep names each string by its
 * KEY and reads it from the locale files the product ships — the same bytes
 * the dashboard renders.
 *
 * Keys, not English values: one English word ("Back", "Cancel") belongs to many
 * keys whose translations differ, so a lookup by value would pick one at random.
 *
 * Only plain strings and `{name}` parameters. A plural (`{count, plural, …}`)
 * is refused rather than half-formatted — a locator built from it would match
 * nothing and the sweep would wait for its timeout instead of saying why.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type UiLocale = 'en-US' | 'ar-EG';

const LOCALES = fileURLToPath(new URL('../../../packages/i18n/locales/', import.meta.url));
const loaded = new Map<string, unknown>();

function namespace(locale: UiLocale, ns: string): unknown {
  const file = `${LOCALES}${locale}/${ns}.json`;
  let doc = loaded.get(file);
  if (doc === undefined) {
    doc = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    loaded.set(file, doc);
  }
  return doc;
}

/** `text('studio:hostedApps.title')` → that string in `locale`. */
export function textIn(locale: UiLocale): (key: string, params?: Record<string, string | number>) => string {
  return (key, params = {}) => {
    const at = key.indexOf(':');
    if (at < 1) throw new Error(`"${key}" is not a namespaced key (ns:path)`);
    let node = namespace(locale, key.slice(0, at));
    for (const part of key.slice(at + 1).split('.')) {
      node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
    }
    if (typeof node !== 'string') throw new Error(`${locale} has no string at "${key}"`);
    if (/\{\s*\w+\s*,/.test(node)) throw new Error(`"${key}" is an ICU plural/select; name the element another way`);
    return node.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
  };
}
