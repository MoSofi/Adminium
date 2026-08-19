// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The icon manifest reaches the validator — the wiring, not the check.
 *
 * `ReferentialContext.allowedIcons` has been documented since M6 as "the bundled
 * lucide manifest (`@adminium/ui` `LUCIDE_ICON_NAMES`)". That symbol existed
 * nowhere in the repo: the only occurrence in the tree was the docblock naming
 * it. `compose.ts` wired `allowedTemplates` and `allowedWidgets` and never
 * `allowedIcons`, so §7.3's unknown-icon warning and its `table` fallback never
 * ran in the shipped product and a model could store any string it invented as a
 * table's icon — which the dashboard then draws as the neutral fallback AFTER
 * fetching the whole 133.6 KiB icon catalogue to discover the name is dead.
 *
 * The manifest is now generated (`scripts/gen-icon-core.mjs` → `icon-names.ts`)
 * and travels to the server the same way the widget vocabularies do: as DATA,
 * because `apps/server` may import neither `@adminium/ui` nor `@adminium/widgets`
 * (01 §2.3, enforced by `.dependency-cruiser.cjs`).
 *
 * These cases are HERMETIC — a temp tree, never this checkout. `packages/ui` is
 * not a dependency of `apps/server`, so `turbo run test`'s `^build` does not
 * build it and asserting against the real `packages/ui/dist` would be a race,
 * green or red depending on scheduling.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BUNDLED_VOCABULARY_FILE,
  iconManifestCandidates,
  loadAllowedVocabularies,
} from '../src/cli/allowlist.js';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A fake package tree: `<tmp>/apps/server` standing in for the server package,
 * with `<tmp>/packages/ui` beside it exactly where the dev-checkout fallback
 * looks. Returns the module URL to pass the loader — `packageRoot()` walks two
 * levels up from it, the same as `src/cli/allowlist.ts` does in production.
 */
async function fakeTree(opts: {
  snapshot?: Record<string, unknown>;
  uiIconNames?: readonly string[];
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'adminium-icon-manifest-'));
  created.push(root);
  const serverRoot = join(root, 'apps', 'server');
  await mkdir(join(serverRoot, 'src', 'cli'), { recursive: true });

  if (opts.snapshot !== undefined) {
    const file = join(serverRoot, BUNDLED_VOCABULARY_FILE);
    await mkdir(join(serverRoot, 'vocabulary'), { recursive: true });
    await writeFile(file, JSON.stringify(opts.snapshot), 'utf8');
  }
  if (opts.uiIconNames !== undefined) {
    const dir = join(root, 'packages', 'ui', 'dist', 'components', 'icon');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'icon-names.js'),
      `export const LUCIDE_ICON_NAMES = ${JSON.stringify(opts.uiIconNames)};\n`,
      'utf8',
    );
  }
  return pathToFileURL(join(serverRoot, 'src', 'cli', 'allowlist.js')).href;
}

const WIDGET_LISTS = {
  LLM_ALLOWED_TEMPLATES: ['page-board'],
  LLM_ALLOWED_WIDGETS: ['widget-kpi-tile'],
};

describe('LLM icon manifest resolution', () => {
  it('probes the package-local snapshot FIRST, then the dev checkout', () => {
    // Same precedence rule as the widget lists, and for the same reason: the
    // JSON snapshot is the ONLY candidate that exists in a Docker image or an
    // npm tarball, because `@adminium/ui` is not a server dependency.
    const candidates = iconManifestCandidates();
    expect(candidates[0]?.endsWith(BUNDLED_VOCABULARY_FILE)).toBe(true);
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.some((path) => path.includes(join('packages', 'ui')))).toBe(true);
  });

  it('loads the icon names out of the bundled snapshot', async () => {
    const moduleUrl = await fakeTree({
      snapshot: { ...WIDGET_LISTS, LUCIDE_ICON_NAMES: ['table', 'square-kanban'] },
    });
    const allowed = await loadAllowedVocabularies(moduleUrl);
    expect(allowed.icons).toEqual(['table', 'square-kanban']);
  });

  it('falls back to the @adminium/ui build when the snapshot predates icons', async () => {
    // A dev checkout reads the widget lists from `packages/widgets/dist`, which
    // knows nothing about icons. Without this fallback the icon check would be
    // off for every source checkout — i.e. for every run of the product that is
    // not a released artifact.
    const moduleUrl = await fakeTree({
      snapshot: WIDGET_LISTS,
      uiIconNames: ['table', 'users', 'square-kanban'],
    });
    const allowed = await loadAllowedVocabularies(moduleUrl);
    expect(allowed.icons).toEqual(['table', 'users', 'square-kanban']);
    expect(allowed.templates).toEqual(['page-board']);
  });

  it('still loads the widget vocabularies when no icon manifest exists anywhere', async () => {
    // Degradation, not failure: the prompt cannot be built without the widget
    // lists, but it is perfectly buildable without the icon manifest — the §7.3
    // icon check simply skips, which is what it is specified to do.
    const moduleUrl = await fakeTree({ snapshot: WIDGET_LISTS });
    const allowed = await loadAllowedVocabularies(moduleUrl);
    expect(allowed.icons).toBeUndefined();
    expect(allowed.widgets).toEqual(['widget-kpi-tile']);
  });
});
