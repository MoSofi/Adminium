// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test-only i18n stand-in. Resolves keys against the REAL en-US bundles
 * (@adminium/i18n/resources — dependency-free leaf) with a minimal ICU-lite
 * formatter, so page tests exercise real keys and interpolated copy without
 * booting the full i18next runtime. Real ICU semantics (plural categories,
 * fallback chain, lazy loading) are covered by @adminium/i18n's own tests.
 */
import { EN_US_RESOURCES, type Namespace, type ResourceBundle } from '@adminium/i18n/resources';

import { setI18nInstance, type I18nInstance } from './t.js';

function lookup(key: string): string | null {
  let ns: Namespace = 'common';
  let path = key;
  const sep = key.indexOf(':');
  if (sep > 0) {
    ns = key.slice(0, sep) as Namespace;
    path = key.slice(sep + 1);
  }
  let node: ResourceBundle[string] | undefined = EN_US_RESOURCES[ns];
  for (const part of path.split('.')) {
    if (node === undefined || typeof node === 'string') return null;
    node = node[part];
  }
  return typeof node === 'string' ? node : null;
}

/** Matches `{arg}`, `{arg, number}` and `{arg, plural, one {…} other {…}}`. */
function formatIcuLite(message: string, args: Record<string, unknown>): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const ch = message[i];
    if (ch !== '{') {
      out += ch;
      i += 1;
      continue;
    }
    // Find the matching close brace.
    let depth = 0;
    let j = i;
    for (; j < message.length; j += 1) {
      if (message[j] === '{') depth += 1;
      if (message[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = message.slice(i + 1, j);
    out += formatPlaceable(body, args);
    i = j + 1;
  }
  return out;
}

function formatPlaceable(body: string, args: Record<string, unknown>): string {
  const comma = body.indexOf(',');
  if (comma === -1) return String(args[body.trim()] ?? `{${body}}`);
  const name = body.slice(0, comma).trim();
  const rest = body.slice(comma + 1).trim();
  const value = args[name];
  if (rest === 'number') {
    return typeof value === 'number' ? new Intl.NumberFormat('en-US').format(value) : String(value);
  }
  if (rest.startsWith('plural,')) {
    const branches: Record<string, string> = {};
    const branchRe = /(\w+|=\d+)\s*\{/g;
    const spec = rest.slice('plural,'.length);
    let match: RegExpExecArray | null;
    while ((match = branchRe.exec(spec)) !== null) {
      const start = branchRe.lastIndex;
      let depth = 1;
      let k = start;
      for (; k < spec.length && depth > 0; k += 1) {
        if (spec[k] === '{') depth += 1;
        if (spec[k] === '}') depth -= 1;
      }
      branches[match[1] ?? ''] = spec.slice(start, k - 1);
      branchRe.lastIndex = k;
    }
    const n = typeof value === 'number' ? value : Number(value);
    const branch = branches[`=${n}`] ?? (n === 1 ? (branches['one'] ?? branches['other']) : branches['other']) ?? '';
    return formatIcuLite(branch, args).replaceAll('#', new Intl.NumberFormat('en-US').format(n));
  }
  return String(value ?? `{${body}}`);
}

/** Installs the stand-in; returns a restore function for afterAll. */
export function installTestI18n(): () => void {
  const fake = {
    language: 'en-US',
    // The stand-in reads the COMPLETE en-US catalogue below, deferred
    // namespaces included, so every namespace is already resolvable and there
    // is nothing to fetch. It still has to exist: the Studio waits on it
    // before rendering (studio/studioMessages.ts), and a stand-in that is
    // missing it fails those pages with a TypeError rather than a diff.
    loadNamespaces: async (): Promise<void> => undefined,
    t: (key: string, options?: Record<string, unknown>): string => {
      const { defaultValue, ...args } = options ?? {};
      const message = lookup(key) ?? (typeof defaultValue === 'string' ? defaultValue : key);
      return formatIcuLite(message, args);
    },
  };
  setI18nInstance(fake as unknown as I18nInstance);
  return () => {
    setI18nInstance(null);
  };
}
