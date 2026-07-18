/**
 * Bundle coverage for the connect wizard's studio.* keys (pre-M12 audit).
 *
 * The cross-locale parity test (packages/i18n parity.test.ts) proves all 8
 * locales carry the SAME key set — it stays green when every locale equally
 * lacks a key, so a wizard shipped on inline fallbacks renders English in all
 * locales without any gate noticing ("parity of absence"). This test closes
 * that hole for the wizard surface: every literal `t('studio.…')` key under
 * src/studio/connect resolves to a real string in the en-US common bundle
 * (the namespace bare keys resolve in — see ./t.ts). Parity then propagates
 * the guarantee to the other 7 locales.
 *
 * Deliberately scoped to src/studio/connect: the remap editor
 * (src/studio/remap, ~95 keys) is still fallback-only and is catalogued as a
 * follow-up sweep; widen the SCAN_ROOT when that lands.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN_US_RESOURCES, type ResourceBundle } from '@adminium/i18n/resources';

// vitest runs with cwd = apps/dashboard (per-package, same under turbo). The
// jsdom environment rewrites import.meta.url to a non-file scheme, so the
// scan root is anchored on cwd instead.
const SCAN_ROOT = join(process.cwd(), 'src/studio/connect');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(path);
  }
  return out;
}

function usedStudioKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of sourceFiles(SCAN_ROOT)) {
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(/\bt\(\s*'(studio\.[^']+)'/g)) {
      const key = match[1] ?? '';
      const files = used.get(key) ?? [];
      files.push(file);
      used.set(key, files);
    }
  }
  return used;
}

function resolveCommon(key: string): string | null {
  let node: ResourceBundle[string] | undefined = EN_US_RESOURCES.common;
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string') return null;
    node = node[part];
  }
  return typeof node === 'string' ? node : null;
}

describe('connect wizard studio.* keys are catalogued in the en-US bundle', () => {
  const used = usedStudioKeys();

  it('the scan finds the wizard surface (regex/tree sanity)', () => {
    // The wizard uses 240+ distinct studio.* keys; a near-zero count means
    // the scan broke (moved directory, changed call shape), not that the
    // wizard shrank — fail loudly rather than vacuously pass.
    expect(used.size).toBeGreaterThan(200);
  });

  it('every used key resolves to a string in en-US common', () => {
    const missing = [...used.keys()].filter((key) => resolveCommon(key) === null).sort();
    expect(missing, `keys missing from packages/i18n/locales/en-US/common.json:\n${missing.join('\n')}`).toEqual([]);
  });
});
