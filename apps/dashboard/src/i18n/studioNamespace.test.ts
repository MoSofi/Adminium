// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The deferred-namespace contract, enforced (10-T06).
 *
 * `studio` is the one namespace @adminium/i18n bundles for nobody and
 * preloads for nobody: ~36 KiB of admin-console text that the Studio's own
 * routes fetch when somebody opens them. That buys ~15 KiB gz off every
 * user's first load and costs three obligations, none of which any existing
 * gate could see:
 *
 * 1. **Every `studio:` key must exist in the en-US bundle.** Same job the
 *    pre-M12 coverage test did for the connect wizard, widened to the whole
 *    surface — the cross-locale parity gate proves the 8 bundles agree with
 *    each other and stays green when they equally lack a key ("parity of
 *    absence"), so it cannot see a screen running on inline fallbacks.
 *
 * 2. **Every one of them must be paired with a fallback that MATCHES the
 *    catalogue.** This is new, and it is the price of deferring: between the
 *    route opening and the chunk landing, and in every unit test that never
 *    boots i18next, the inline fallback is the text on screen. A drifted
 *    fallback used to be invisible (the catalogue always won); now it is a
 *    flash of different wording. Reconciling these is what the 2026-08-18
 *    chunk-budget record called out as the real work behind this change, and
 *    this is what keeps them reconciled.
 *
 * 3. **Nothing outside `src/studio` may read a `studio:` key.** The Topbar
 *    used to title its two Studio menu items from `studio.hub.title` and
 *    `studio.settingsHub.title`; it paints on every route, long before any
 *    Studio chunk exists, so after the move it would have shown English to a
 *    German admin. It has its own `topbar.*` keys now. This is the assertion
 *    that catches the next one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN_US_RESOURCES, type ResourceBundle } from '@adminium/i18n/resources';

// vitest runs with cwd = apps/dashboard (per-package, same under turbo). The
// jsdom environment rewrites import.meta.url to a non-file scheme, so the scan
// root is anchored on cwd instead.
const SRC = join(process.cwd(), 'src');
const STUDIO = join(SRC, 'studio');

/**
 * A `'studio:key'` literal and the string literal that follows it — which is
 * the fallback in all three shapes the tree uses:
 *
 *   t('studio:a.b', 'Fallback')                       // the common one
 *   t('studio:a.b', "Fallback with an apostrophe")    // double-quoted
 *   { key: 'studio:a.b', fallback: 'Fallback' }       // option tables
 *
 * Requiring the pair to match is deliberate: an unpaired key is a call site
 * with no fallback at all, which is a blank screen while the chunk loads.
 */
const PAIRED = /'studio:([A-Za-z0-9_.]+)'\s*,\s*(?:[A-Za-z][A-Za-z0-9_]*\s*:\s*)?('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
const ANY_KEY = /'studio:([A-Za-z0-9_.]+)'/g;

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
  let node: ResourceBundle[string] | undefined = EN_US_RESOURCES.studio;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return null;
    node = node[part];
  }
  return typeof node === 'string' ? node : null;
}

/** The source text of a JS string literal, quotes and escapes resolved. */
function literalText(raw: string): string {
  const body = raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
  return JSON.parse(`"${body.replace(/"/g, '\\"')}"`) as string;
}

interface Site {
  file: string;
  key: string;
  fallback: string;
}

function studioSites(): { sites: Site[]; unpaired: string[] } {
  const sites: Site[] = [];
  const unpaired: string[] = [];
  for (const file of sourceFiles(STUDIO, false)) {
    const src = readFileSync(file, 'utf8');
    const pairedAt = new Set<number>();
    for (const match of src.matchAll(PAIRED)) {
      pairedAt.add(match.index);
      sites.push({ file, key: match[1] ?? '', fallback: literalText(match[2] ?? "''") });
    }
    for (const match of src.matchAll(ANY_KEY)) {
      if (pairedAt.has(match.index)) continue;
      unpaired.push(`${file}: studio:${match[1] ?? ''}`);
    }
  }
  return { sites, unpaired };
}

describe('the deferred `studio` namespace', () => {
  const { sites, unpaired } = studioSites();

  it('the scan finds the Studio surface (regex/tree sanity)', () => {
    // The console uses ~1,000 distinct studio keys. A near-zero count means
    // the scan broke — a moved directory, a changed call shape — not that the
    // console shrank, and every assertion below would then pass vacuously.
    expect(new Set(sites.map((s) => s.key)).size).toBeGreaterThan(800);
  });

  it('every key is paired with an inline fallback', () => {
    expect(unpaired, `call sites with no fallback to render before the chunk lands:\n${unpaired.join('\n')}`).toEqual(
      [],
    );
  });

  it('every key resolves in the en-US studio bundle', () => {
    const missing = [...new Set(sites.filter((s) => catalogued(s.key) === null).map((s) => s.key))].sort();
    expect(missing, `keys missing from packages/i18n/locales/en-US/studio.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('every fallback is the catalogue text, character for character', () => {
    const drifted = sites
      .filter((s) => catalogued(s.key) !== null && catalogued(s.key) !== s.fallback)
      .map((s) => `${s.key}\n  catalogue: ${JSON.stringify(catalogued(s.key))}\n  fallback:  ${JSON.stringify(s.fallback)}\n  ${s.file}`);
    expect(drifted, `inline fallbacks that no longer match the bundle:\n${drifted.join('\n\n')}`).toEqual([]);
  });

  it('is read from nowhere but the Studio', () => {
    const outside: string[] = [];
    for (const file of sourceFiles(SRC, true)) {
      if (file.startsWith(`${STUDIO}/`) || file === STUDIO) continue;
      if (file === join(SRC, 'i18n', 'studioNamespace.test.ts')) continue;
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(ANY_KEY)) outside.push(`${file}: studio:${match[1] ?? ''}`);
    }
    expect(
      outside,
      `a deferred namespace read outside the surface that loads it — these render English until\n` +
        `somebody opens the Studio, and never in the user's own language:\n${outside.join('\n')}`,
    ).toEqual([]);
  });
});
