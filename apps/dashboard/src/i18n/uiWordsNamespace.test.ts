// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The widget and template words, deferred.
 *
 * en-US ships `ui.widgets.*` and `ui.templates.*` as their own chunk
 * (`UI_DEFERRED_GROUPS`, packages/i18n/src/resources/namespaces.ts): ~18 KiB
 * gz off every user's first load. The obligations that buys, enforced:
 *
 * 1. every key named by a literal resolves in the en-US `ui` bundle;
 * 2. inside @adminium/widgets every translator WAITS for the words
 *    (`src/lib/i18n.ts`, `useUiWords`): no module there reads a translator
 *    from `@adminium/i18n/react` directly, so no widget or template paints
 *    before its words are in — its inline English never shows;
 * 3. outside it (the Studio's page editor, the template picker), where
 *    nothing waits, every key is paired with an inline fallback that is the
 *    catalogue's text character for character — the frame before the chunk
 *    lands says what the frame after it does;
 * 4. the eager en-US `ui` carries neither group, and nothing on the first
 *    paint names one — the dashboard's build refuses an entry chunk that
 *    does (`scripts/check-entry-budget.mjs`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN_US_EAGER, EN_US_RESOURCES, UI_DEFERRED_GROUPS, type ResourceBundle } from '@adminium/i18n/resources';

import { literalText } from './sourceLiteral.js';

// vitest runs with cwd = apps/dashboard.
const WIDGETS = join(process.cwd(), '..', '..', 'packages', 'widgets', 'src');
/** Where nothing waits for the words. */
const OUTSIDE = [join(process.cwd(), 'src'), join(process.cwd(), '..', '..', 'packages', 'ui', 'src')];

const GROUPS = UI_DEFERRED_GROUPS.join('|');
const PAIRED = new RegExp(`'ui:((?:${GROUPS})\\.[A-Za-z0-9_.]+)'\\s*,\\s*(?:[A-Za-z][A-Za-z0-9_]*\\s*:\\s*)?('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`, 'g');
const ANY_KEY = new RegExp(`'ui:((?:${GROUPS})\\.[A-Za-z0-9_.]+)'`, 'g');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name)) out.push(path);
  }
  return out;
}

function catalogued(key: string): string | null {
  let node: ResourceBundle[string] | undefined = EN_US_RESOURCES.ui;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return null;
    node = node[part];
  }
  return typeof node === 'string' ? node : null;
}

interface Site {
  file: string;
  key: string;
  fallback: string;
}

function sites(roots: readonly string[]): { paired: Site[]; unpaired: string[]; keys: Set<string> } {
  const paired: Site[] = [];
  const unpaired: string[] = [];
  const keys = new Set<string>();
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const src = readFileSync(file, 'utf8');
      const at = new Set<number>();
      for (const match of src.matchAll(PAIRED)) {
        const fallback = literalText(match[2] ?? "''");
        // A key followed by another key is a table of keys, not a call with its fallback.
        if (fallback.startsWith('ui:')) continue;
        at.add(match.index);
        paired.push({ file, key: match[1] ?? '', fallback });
      }
      for (const match of src.matchAll(ANY_KEY)) {
        keys.add(match[1] ?? '');
        if (!at.has(match.index)) unpaired.push(`${file}: ui:${match[1] ?? ''}`);
      }
    }
  }
  return { paired, unpaired, keys };
}

describe('the deferred widget and template words', () => {
  const inside = sites([WIDGETS]);
  const outside = sites(OUTSIDE);

  it('the scan finds them (regex/tree sanity)', () => {
    expect(inside.keys.size).toBeGreaterThan(700);
    expect(outside.keys.size).toBeGreaterThan(0);
  });

  it('every key named by a literal resolves in the en-US ui bundle', () => {
    const missing = [...inside.keys, ...outside.keys].filter((key) => catalogued(key) === null).sort();
    expect(missing, `keys missing from packages/i18n/locales/en-US/ui.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every widget translator waits for the words', () => {
    const direct = sourceFiles(WIDGETS)
      .filter((file) => !file.endsWith(join('lib', 'i18n.ts')))
      .filter((file) => /import\s*\{[^}]*\b(useMaybeT|useT)\b[^}]*\}\s*from\s*'@adminium\/i18n\/react'/.test(readFileSync(file, 'utf8')));
    expect(direct, `widget modules translating without waiting (import useMaybeT from src/lib/i18n.js):\n${direct.join('\n')}`).toEqual([]);
  });

  it('outside the widgets, every key is paired with an inline fallback', () => {
    expect(outside.unpaired, `call sites with no fallback:\n${outside.unpaired.join('\n')}`).toEqual([]);
  });

  it('outside the widgets, every fallback is the catalogue text, character for character', () => {
    const drifted = outside.paired
      .filter((s) => catalogued(s.key) !== null && catalogued(s.key) !== s.fallback)
      .map((s) => `${s.key}\n  catalogue: ${JSON.stringify(catalogued(s.key))}\n  fallback:  ${JSON.stringify(s.fallback)}\n  ${s.file}`);
    expect(drifted, `inline fallbacks that no longer match the bundle:\n${drifted.join('\n\n')}`).toEqual([]);
  });

  it('are out of the eager en-US ui, and all of them are in the whole catalogue', () => {
    for (const group of UI_DEFERRED_GROUPS) {
      expect(EN_US_EAGER.ui[group]).toBeUndefined();
      expect(EN_US_RESOURCES.ui[group]).toBeDefined();
    }
    const json = JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'packages', 'i18n', 'locales', 'en-US', 'ui.json'), 'utf8')) as ResourceBundle;
    expect(EN_US_RESOURCES.ui).toEqual(json);
  });
});
