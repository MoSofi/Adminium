// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The deferred `roles` namespace's contract (`DEFERRED_NAMESPACES`; the
 * `files` gate's twin, `filesNamespace.test.ts`):
 *
 * 1. Every `roles:` key must exist in the en-US bundle.
 * 2. Every call site carries an inline fallback that is the catalogue text,
 *    character for character — the fallback is what renders until the chunk
 *    lands, and a drifted one is a second, unreviewed copy of the message.
 * 3. Nothing but `team/RolesPage.tsx` may read a `roles:` key: the
 *    `/settings/roles` route is the one surface that awaits the namespace.
 *    The surface is a FILE, not a directory, because the Team page lives in
 *    the same folder and does not await it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { EN_US_RESOURCES, type ResourceBundle } from '@adminium/i18n/resources';

import { literalText } from './sourceLiteral.js';

const SRC = join(process.cwd(), 'src');
const ROLES_PAGE = join(SRC, 'team', 'RolesPage.tsx');

const PAIRED = /'roles:([A-Za-z0-9_.-]+)'\s*,\s*(?:[A-Za-z][A-Za-z0-9_]*\s*:\s*)?('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
const ANY_KEY = /'roles:([A-Za-z0-9_.-]+)'/g;

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
  let node: ResourceBundle[string] | undefined = EN_US_RESOURCES.roles;
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

function rolesSites(): { sites: Site[]; unpaired: string[] } {
  const sites: Site[] = [];
  const unpaired: string[] = [];
  const src = readFileSync(ROLES_PAGE, 'utf8');
  const pairedAt = new Set<number>();
  for (const match of src.matchAll(PAIRED)) {
    pairedAt.add(match.index);
    sites.push({ file: ROLES_PAGE, key: match[1] ?? '', fallback: literalText(match[2] ?? "''") });
  }
  for (const match of src.matchAll(ANY_KEY)) {
    if (pairedAt.has(match.index)) continue;
    unpaired.push(`${ROLES_PAGE}: roles:${match[1] ?? ''}`);
  }
  return { sites, unpaired };
}

describe('the deferred `roles` namespace', () => {
  const { sites, unpaired } = rolesSites();

  it('the scan finds the roles surface (regex/tree sanity)', () => {
    expect(new Set(sites.map((s) => s.key)).size).toBeGreaterThan(60);
  });

  it('every key is paired with an inline fallback', () => {
    expect(unpaired, `call sites with no fallback to render before the chunk lands:\n${unpaired.join('\n')}`).toEqual([]);
  });

  it('every key resolves in the en-US roles bundle', () => {
    const missing = [...new Set(sites.filter((s) => catalogued(s.key) === null).map((s) => s.key))].sort();
    expect(missing, `keys missing from packages/i18n/locales/en-US/roles.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every fallback is the catalogue text, character for character', () => {
    const drifted = sites
      .filter((s) => catalogued(s.key) !== null && catalogued(s.key) !== s.fallback)
      .map((s) => `${s.key}\n  catalogue: ${JSON.stringify(catalogued(s.key))}\n  fallback:  ${JSON.stringify(s.fallback)}\n  ${s.file}`);
    expect(drifted, `inline fallbacks that no longer match the bundle:\n${drifted.join('\n\n')}`).toEqual([]);
  });

  it('is read from nowhere but the Roles page', () => {
    const outside: string[] = [];
    for (const file of sourceFiles(SRC, true)) {
      if (file === ROLES_PAGE) continue;
      if (file === join(SRC, 'i18n', 'rolesNamespace.test.ts')) continue;
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(ANY_KEY)) outside.push(`${file}: roles:${match[1] ?? ''}`);
    }
    expect(
      outside,
      `a deferred namespace read outside the surface that loads it — these render English until\n` +
        `somebody opens /settings/roles, and never in the user's own language:\n${outside.join('\n')}`,
    ).toEqual([]);
  });

  it('nothing still reads the old `common:roles.*` address', () => {
    // The move's own regression: `t('roles.title')` with no namespace resolves
    // against `common`, where the key no longer exists, and silently renders
    // its inline English for every locale.
    const stale: string[] = [];
    const OLD = /\bt\(\s*'(?:common:)?roles\.([A-Za-z0-9_.-]+)'/g;
    for (const file of sourceFiles(SRC, false)) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(OLD)) stale.push(`${file}: roles.${match[1] ?? ''}`);
    }
    expect(stale, `call sites still reading the pre-move common:roles.* keys:\n${stale.join('\n')}`).toEqual([]);
  });
});
