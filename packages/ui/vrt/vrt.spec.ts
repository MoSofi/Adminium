// SPDX-License-Identifier: AGPL-3.0-only
/**
 * VRT story-matrix runner (03-component-library.md §10, M1-T07).
 *
 * Reads the static Storybook's index.json, filters stories tagged `vrt`
 * (the Matrix stories — one static grid per component), and screenshots each
 * one across the profile matrix:
 *
 *   every vrt story:            {light, dark} × {ltr, rtl}   (accent indigo)
 *   representative subset:      accent-black (light/ltr)     (worst-case accent)
 *
 * Determinism (§10):
 *  - `reducedMotion: 'reduce'` emulation (playwright.config.ts) forces nb-*
 *    keyframe end-states via the tokens motion gate;
 *  - waits for the `data-vrt-ready` attribute .storybook/preview.tsx stamps
 *    after mount effects settle, then `document.fonts.ready`;
 *  - `animations: 'disabled'`, `caret: 'hide'` on every screenshot;
 *  - anything inherently dynamic is masked: stories/components mark such
 *    regions with `data-vrt-mask` (masked magenta in the capture).
 *
 * Baselines: vrt/__screenshots__/<story-id>--<profile>.png (Linux-only;
 * see playwright.config.ts header for the `pnpm vrt:update` flow).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

interface IndexEntry {
  id: string;
  type: string;
  title: string;
  name: string;
  tags?: string[];
}

interface Profile {
  name: string;
  globals: { theme: 'light' | 'dark'; accent: string; density: string; dir: 'ltr' | 'rtl' };
}

const profile = (
  name: string,
  theme: 'light' | 'dark',
  dir: 'ltr' | 'rtl',
  accent = 'indigo',
): Profile => ({ name, globals: { theme, accent, density: 'comfortable', dir } });

/** Full matrix — every vrt-tagged story. */
const CORE_PROFILES: Profile[] = [
  profile('light', 'light', 'ltr'),
  profile('dark', 'dark', 'ltr'),
  profile('rtl', 'light', 'rtl'),
  profile('dark-rtl', 'dark', 'rtl'),
];

/**
 * Accent stress profile — captured only for the representative subset below.
 * Black is the worst-case accent for contrast/derived tones (03 §9 OD-2).
 */
const ACCENT_PROFILES: Profile[] = [profile('accent-black', 'light', 'ltr', 'black')];

/**
 * Representative subset for the non-default accent: components whose chrome
 * derives heavily from --accent / --accent-soft. Matched as title prefixes
 * against the story id (kebab-cased by Storybook).
 */
const ACCENT_SUBSET = [
  'tier1-button--',
  'tier1-badge--',
  'tier1-iconbutton--',
  'tier2-input--',
  'tier2-checkbox--',
  'tier2-switch--',
  'tier2-segmentedcontrol--',
  'tier3-tabs--',
  'tier3-toast--',
  'tier3-pagination--',
];

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(pkgRoot, 'storybook-static', 'index.json');

// The webServer command (ensure-storybook.mjs) builds storybook before the
// server comes up, but Playwright collects tests first — so on a truly cold
// checkout the index may not exist yet at collection time. Fail with a clear
// message instead of an unhandled ENOENT.
if (!existsSync(indexPath)) {
  test('storybook-static/index.json exists', () => {
    throw new Error(
      'storybook-static/index.json not found. Run `pnpm build-storybook` once, then re-run `pnpm vrt`.',
    );
  });
} else {
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
    entries: Record<string, IndexEntry>;
  };
  const stories = Object.values(index.entries).filter(
    (entry) => entry.type === 'story' && (entry.tags ?? []).includes('vrt'),
  );

  test.describe('VRT matrix', () => {
    for (const story of stories) {
      const profiles = ACCENT_SUBSET.some((prefix) => story.id.startsWith(prefix))
        ? [...CORE_PROFILES, ...ACCENT_PROFILES]
        : CORE_PROFILES;

      for (const { name, globals } of profiles) {
        test(`${story.id} — ${name}`, async ({ page }) => {
          const globalsParam = `theme:${globals.theme};accent:${globals.accent};density:${globals.density};dir:${globals.dir}`;
          // `networkidle`: widget bodies load as per-family chunks AFTER the
          // frame renders, so `domcontentloaded` screenshots an empty header.
          // See the same note in scripts/a11y-sweep.mjs — this is why no
          // baseline captured before now would have been worth keeping.
          await page.goto(`/iframe.html?id=${story.id}&globals=${globalsParam}`, {
            waitUntil: 'networkidle',
          });
          // preview.tsx stamps this after the story's mount effects settle
          await page.waitForSelector('html[data-vrt-ready="true"]', { timeout: 15_000 });
          // deterministic type rendering — self-hosted fonts must be loaded
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          // paranoia: axis attributes actually applied before capture
          await page.waitForSelector(
            `html[data-theme="${globals.theme}"][data-accent="${globals.accent}"][dir="${globals.dir}"]`,
            { timeout: 5_000 },
          );
          await expect(page).toHaveScreenshot(`${story.id}--${name}.png`, {
            fullPage: true,
            // known-dynamic regions opt in via data-vrt-mask
            mask: [page.locator('[data-vrt-mask]')],
          });
        });
      }
    }
  });
}
