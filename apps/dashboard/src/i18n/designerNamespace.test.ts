// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The deferred `designer` namespace's contract (`DEFERRED_NAMESPACES`):
 *
 * 1. Every `designer:` key exists in the en-US bundle.
 * 2. Every call site carries an inline fallback that is the catalogue text,
 *    character for character — it is what renders until the chunk lands.
 * 3. Nothing outside `src/designer/` reads a `designer:` key: the Designer's
 *    lazy routes are the one surface that awaits the namespace.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';
import { EN_US_RESOURCES, type ResourceBundle } from '@adminium/i18n/resources';

import { literalText } from './sourceLiteral.js';

const SRC = join(process.cwd(), 'src');
const SURFACE = join(SRC, 'designer');

const PAIRED = /'designer:([A-Za-z0-9_.-]+)'\s*,\s*(?:[A-Za-z][A-Za-z0-9_]*\s*:\s*)?('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
const ANY_KEY = /'designer:([A-Za-z0-9_.-]+)'/g;

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
  let node: ResourceBundle[string] | undefined = EN_US_RESOURCES.designer;
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

function designerSites(): { sites: Site[]; unpaired: string[] } {
  const sites: Site[] = [];
  const unpaired: string[] = [];
  for (const file of sourceFiles(SURFACE, false)) {
    const src = readFileSync(file, 'utf8');
    const pairedAt = new Set<number>();
    for (const match of src.matchAll(PAIRED)) {
      pairedAt.add(match.index);
      sites.push({ file, key: match[1] ?? '', fallback: literalText(match[2] ?? "''") });
    }
    for (const match of src.matchAll(ANY_KEY)) {
      if (!pairedAt.has(match.index)) unpaired.push(`${file}: designer:${match[1] ?? ''}`);
    }
  }
  return { sites, unpaired };
}

describe('the deferred `designer` namespace', () => {
  const { sites, unpaired } = designerSites();

  it('the scan finds the Designer’s pages', () => {
    expect(new Set(sites.map((site) => site.key)).size).toBeGreaterThan(3);
  });

  it('every key is paired with an inline fallback', () => {
    expect(unpaired, `call sites with no fallback:\n${unpaired.join('\n')}`).toEqual([]);
  });

  it('every key resolves in the en-US designer bundle', () => {
    const missing = [...new Set(sites.filter((site) => catalogued(site.key) === null).map((site) => site.key))].sort();
    expect(missing, `keys missing from packages/i18n/locales/en-US/designer.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every fallback is the catalogue text, character for character', () => {
    const drifted = sites
      .filter((site) => catalogued(site.key) !== null && catalogued(site.key) !== site.fallback)
      .map((site) => `${site.key}\n  catalogue: ${JSON.stringify(catalogued(site.key))}\n  fallback:  ${JSON.stringify(site.fallback)}\n  ${site.file}`);
    expect(drifted, `inline fallbacks that no longer match the bundle:\n${drifted.join('\n\n')}`).toEqual([]);
  });

  it('is read from nowhere but the Designer’s own pages', () => {
    const outside: string[] = [];
    for (const file of sourceFiles(SRC, true)) {
      if (file.startsWith(SURFACE + sep) || file === join(SRC, 'i18n', 'designerNamespace.test.ts')) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(ANY_KEY)) outside.push(`${file}: designer:${match[1] ?? ''}`);
    }
    expect(outside, `a deferred namespace read outside the surface that loads it:\n${outside.join('\n')}`).toEqual([]);
  });
});
