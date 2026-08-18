// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The generated core icon set, and the two ways it can rot.
 *
 * THE BUG THIS PINS. `Icon` and the dashboard's `lucideByName` both resolved an
 * icon from a runtime name via `import { icons } from 'lucide-react'`. A map
 * lookup is opaque to a bundler, so all 1,611 icon modules landed in the
 * dashboard's ENTRY chunk — 112.6 KiB gzipped, measured by stubbing both
 * imports and rebuilding, on every cold load, for the ~130 icons the product
 * draws.
 *
 * The fix is a generated set of named imports, which introduces its own failure
 * mode: a set that stops covering the product degrades SILENTLY into a
 * placeholder that fills in a frame later. So this asserts both directions —
 * the file matches the generator, and the generator still sees the product.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CORE_ICONS } from './icon-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..', '..');
const ARTIFACT = join(here, 'icon-core.ts');

describe('icon-core.ts', () => {
  it('matches what the generator would write', () => {
    // `--check` exits non-zero with the command that fixes it.
    expect(() =>
      execFileSync('node', [join(repoRoot, 'scripts', 'gen-icon-core.mjs'), '--check'], {
        cwd: repoRoot,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('imports icons by name, never the whole map', () => {
    // The one line that would undo all of this.
    const source = readFileSync(ARTIFACT, 'utf8');
    expect(source).not.toMatch(/import\s*\{[^}]*\bicons\b[^}]*\}\s*from\s*'lucide-react'/);
    expect(source).not.toMatch(/import\s+\*\s+as/);
  });

  it('covers the icons the onboarding checklist renders by name', () => {
    // `<Icon name={...}>` from a data table is the shape the scan is most
    // likely to miss, and the checklist is on a first-run screen where a
    // placeholder swap is at its most visible.
    const steps = readFileSync(
      join(repoRoot, 'apps', 'dashboard', 'src', 'onboarding', 'steps.ts'),
      'utf8',
    );
    const used = [...steps.matchAll(/\bicon:\s*'([A-Za-z0-9]+)'/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThan(0);
    for (const name of [...used, 'Check']) {
      expect(CORE_ICONS[name], `${name} is rendered on first run but is not in the core set`).toBeDefined();
    }
  });

  it('is a real subset, not the whole catalogue smuggled back in', () => {
    // If this ever approaches four figures, something has started adding names
    // wholesale and the entry cost is back.
    const count = Object.keys(CORE_ICONS).length;
    expect(count).toBeGreaterThan(80);
    expect(count).toBeLessThan(400);
  });
});
