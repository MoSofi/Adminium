// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A side's copy of its site template (`src/site/`) is changed whole: the new copy is written beside
 * it (`src/.site-new/`), the old one moved aside (`src/.site-aside/`), the new one moved in, and the
 * old one taken away. A crash can stop that at any step, so every `use_site` and every side build
 * first puts the folder back in order: an aside copy alone is the last good one and goes back; an
 * aside copy beside a `site/` is the old one and goes; a new copy never moved in goes.
 */
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const SITE_DIR = 'site';
const NEW_DIR = '.site-new';
const ASIDE_DIR = '.site-aside';

/** Puts a side's `src/site/` back in order after a swap a crash stopped. */
export function recoverSiteSwap(src: string): void {
  const site = join(src, SITE_DIR);
  const aside = join(src, ASIDE_DIR);
  rmSync(join(src, NEW_DIR), { recursive: true, force: true });
  if (!existsSync(aside)) return;
  if (existsSync(site)) rmSync(aside, { recursive: true, force: true });
  else renameSync(aside, site);
}

/**
 * Swaps a side's `src/site/` for a copy `write` makes in a folder of its own. `step` is called
 * between the steps, for a test to stop the swap where a crash would.
 */
export function swapSite(src: string, write: (dir: string) => void, step: (at: 'written' | 'aside' | 'moved-in') => void = () => undefined): void {
  recoverSiteSwap(src);
  const site = join(src, SITE_DIR);
  const fresh = join(src, NEW_DIR);
  const aside = join(src, ASIDE_DIR);
  write(fresh);
  step('written');
  if (existsSync(site)) renameSync(site, aside);
  step('aside');
  renameSync(fresh, site);
  step('moved-in');
  rmSync(aside, { recursive: true, force: true });
}
