// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The deferred `files` namespace's contract (`DEFERRED_NAMESPACES`; the
 * `studio` gate's twin, `studioNamespace.test.ts`):
 *
 * 1. Every `files:` key must exist in the en-US bundle.
 * 2. Every call site carries an inline fallback that is the catalogue text,
 *    character for character — the fallback is what renders until the chunk
 *    lands, and a drifted one is a second, unreviewed copy of the message.
 * 3. Nothing outside `src/files` may read a `files:` key: the surface that
 *    loads the namespace is the only one that may depend on it.
 *
 * Rule 3 is why `pages/PageFilesBinding.tsx` has no labels prop: the
 * `page-files` TEMPLATE renders inside a user-built page that never awaits
 * this namespace, so it leans on the widget's own `ui:templates.files.*`
 * fallback instead.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { EN_US_RESOURCES, type ResourceBundle } from '@adminium/i18n/resources';

import { literalText } from './sourceLiteral.js';

const SRC = join(process.cwd(), 'src');
const FILES = join(SRC, 'files');

const PAIRED = /'files:([A-Za-z0-9_.-]+)'\s*,\s*(?:[A-Za-z][A-Za-z0-9_]*\s*:\s*)?('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
const ANY_KEY = /'files:([A-Za-z0-9_.-]+)'/g;

function sourceFiles(dir: string, includeTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path, includeTests));
    else if (/\.(ts|tsx)$/.test(entry.name) && (includeTests || !/\.test\./.test(entry.name))) out.push(path);
  }
  return out;
}

function catalogued(key: string): string | null {
  let node: ResourceBundle[string] | undefined = EN_US_RESOURCES.files;
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

function filesSites(): { sites: Site[]; unpaired: string[] } {
  const sites: Site[] = [];
  const unpaired: string[] = [];
  for (const file of sourceFiles(FILES, false)) {
    const src = readFileSync(file, 'utf8');
    const pairedAt = new Set<number>();
    for (const match of src.matchAll(PAIRED)) {
      pairedAt.add(match.index);
      sites.push({ file, key: match[1] ?? '', fallback: literalText(match[2] ?? "''") });
    }
    for (const match of src.matchAll(ANY_KEY)) {
      if (pairedAt.has(match.index)) continue;
      unpaired.push(`${file}: files:${match[1] ?? ''}`);
    }
  }
  return { sites, unpaired };
}

describe('the deferred `files` namespace', () => {
  const { sites, unpaired } = filesSites();

  it('the scan finds the files surface (regex/tree sanity)', () => {
    expect(new Set(sites.map((s) => s.key)).size).toBeGreaterThan(60);
  });

  it('every key is paired with an inline fallback', () => {
    expect(unpaired, `call sites with no fallback to render before the chunk lands:\n${unpaired.join('\n')}`).toEqual([]);
  });

  it('every key resolves in the en-US email bundle', () => {
    const missing = [...new Set(sites.filter((s) => catalogued(s.key) === null).map((s) => s.key))].sort();
    expect(missing, `keys missing from packages/i18n/locales/en-US/files.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every fallback is the catalogue text, character for character', () => {
    const drifted = sites
      .filter((s) => catalogued(s.key) !== null && catalogued(s.key) !== s.fallback)
      .map((s) => `${s.key}\n  catalogue: ${JSON.stringify(catalogued(s.key))}\n  fallback:  ${JSON.stringify(s.fallback)}\n  ${s.file}`);
    expect(drifted, `inline fallbacks that no longer match the bundle:\n${drifted.join('\n\n')}`).toEqual([]);
  });

  it('is read from nowhere but the email surface', () => {
    const outside: string[] = [];
    for (const file of sourceFiles(SRC, true)) {
      if (file.startsWith(`${FILES}/`) || file === FILES) continue;
      if (file === join(SRC, 'i18n', 'filesNamespace.test.ts')) continue;
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(ANY_KEY)) outside.push(`${file}: files:${match[1] ?? ''}`);
    }
    expect(
      outside,
      `a deferred namespace read outside the surface that loads it — these render English until\n` +
        `somebody opens the files surface, and never in the user's own language:\n${outside.join('\n')}`,
    ).toEqual([]);
  });
});
