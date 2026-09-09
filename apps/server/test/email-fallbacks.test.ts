// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The deferred `email` namespace's contract, on the SERVER side.
 *
 * The dashboard has four of these gates already (`emailNamespace.test.ts` and
 * its siblings), and every one of them anchors on `join(process.cwd(), 'src')`
 * with cwd = apps/dashboard. They are therefore structurally blind to
 * apps/server — which is where ALL 143 `email:` call sites actually live, since
 * these messages render system email, not a screen.
 *
 * That blindness had already cost something. These keys sat in `common` until
 * 2026-09-08 — the eagerly bundled namespace — so they resolved by luck rather
 * than by design; the moment they moved to a deferred namespace, they resolved
 * only because `createServerI18n` now loads the deferred set explicitly
 * (packages/i18n/src/server.ts). Nothing on this side was checking either fact.
 *
 * So: every `email:` key a server module names must exist in the en-US bundle,
 * and its inline `defaultValue` must be that bundle's text character for
 * character. The defaultValue is what i18next renders if the namespace is ever
 * missing again, and a drifted one is a second, unreviewed copy of the message
 * that no translator will ever see.
 *
 * The regex is deliberately looser than the dashboard's. Server calls pass an
 * OPTIONS OBJECT (`t(key, { count, defaultValue: '…' })`) rather than a bare
 * second argument, and several fold a long sentence across lines with `+`. A
 * strict single-literal pattern matched only 106 of the 143 sites and reported
 * four false drifts — a gate that quietly skips a quarter of its subject is
 * worse than no gate, so `sites()` asserts its own coverage below.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { EN_US_RESOURCES, type ResourceBundle } from '@adminium/i18n/resources';

const SRC = join(process.cwd(), 'src');
const KEY = /t\(\s*'email:([A-Za-z0-9_.-]+)'/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.ts$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(path);
  }
  return out;
}

function catalogued(key: string): string | null {
  let node: ResourceBundle[string] | undefined = EN_US_RESOURCES.email;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return null;
    node = node[part];
  }
  return typeof node === 'string' ? node : null;
}

function literalText(raw: string): string {
  const body = raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
  return JSON.parse(`"${body.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`) as string;
}

/**
 * The `defaultValue:` that belongs to the call starting at `from`, with any
 * `'a ' + 'b'` continuation folded in. Scans forward under brace/paren depth so
 * a nested object in the same options bag cannot be mistaken for the end.
 */
function defaultValueAt(src: string, from: number): string | null {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '{') depth++;
    else if (c === ')' || c === '}') {
      depth--;
      if (depth <= 0) return null;
    } else if (src.startsWith('defaultValue:', i) && depth >= 1) {
      const tail = src.slice(i + 'defaultValue:'.length);
      const parts: string[] = [];
      const piece = /^\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/;
      let rest = tail;
      for (;;) {
        const m = piece.exec(rest);
        if (m === null) break;
        parts.push(literalText(m[1] ?? "''"));
        rest = rest.slice(m[0].length);
        const plus = /^\s*\+/.exec(rest);
        if (plus === null) break;
        rest = rest.slice(plus[0].length);
      }
      return parts.length === 0 ? null : parts.join('');
    }
  }
  return null;
}

interface Site {
  file: string;
  key: string;
  fallback: string | null;
}

function sites(): Site[] {
  const out: Site[] = [];
  for (const file of sourceFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(KEY)) {
      out.push({ file, key: match[1] ?? '', fallback: defaultValueAt(src, match.index) });
    }
  }
  return out;
}

describe('the deferred `email` namespace, server side', () => {
  const found = sites();

  it('the scan reaches the whole email surface (regex/tree sanity)', () => {
    // 143 keys moved out of `common` in 2026-09-08's namespace split. If this
    // drops, the gate has gone blind rather than the surface having shrunk —
    // check the regex before lowering it.
    expect(found.length).toBeGreaterThanOrEqual(140);
  });

  it('every key carries an inline defaultValue', () => {
    const bare = found.filter((s) => s.fallback === null).map((s) => `${s.file}: email:${s.key}`);
    expect(bare, `server call sites with no defaultValue to fall back on:\n${bare.join('\n')}`).toEqual([]);
  });

  it('every key resolves in the en-US email bundle', () => {
    const missing = [...new Set(found.filter((s) => catalogued(s.key) === null).map((s) => s.key))].sort();
    expect(missing, `keys missing from packages/i18n/locales/en-US/email.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every defaultValue is the catalogue text, character for character', () => {
    const drifted = found
      .filter((s) => s.fallback !== null && catalogued(s.key) !== null && catalogued(s.key) !== s.fallback)
      .map((s) => `${s.key}\n  catalogue: ${JSON.stringify(catalogued(s.key))}\n  fallback:  ${JSON.stringify(s.fallback)}\n  ${s.file}`);
    expect(drifted, `server defaultValues that no longer match the bundle:\n${drifted.join('\n\n')}`).toEqual([]);
  });
});
