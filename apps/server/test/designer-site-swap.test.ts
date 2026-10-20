// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A side's copy of its site template is changed whole. A crash at each step of the swap leaves the
 * old copy or the new one, never half of either, and the next swap or build can tell which.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recoverSiteSwap, swapSite } from '../src/project/apps/site-swap.js';

let src: string;
beforeEach(() => {
  src = mkdtempSync(join(tmpdir(), 'adminium-site-swap-'));
  mkdirSync(join(src, 'site'));
  writeFileSync(join(src, 'site', 'index.css'), 'old');
});
afterEach(() => {
  rmSync(src, { recursive: true, force: true });
});

const write = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.css'), 'new');
};
const site = (): string => readFileSync(join(src, 'site', 'index.css'), 'utf8');
const crashAt =
  (at: 'written' | 'aside' | 'moved-in') =>
  (step: string): void => {
    if (step === at) throw new Error('crash');
  };

describe('the swap of a template copy', () => {
  it('puts the new copy in and takes the old one away', () => {
    swapSite(src, write);
    expect(site()).toBe('new');
    expect(existsSync(join(src, '.site-aside'))).toBe(false);
    expect(existsSync(join(src, '.site-new'))).toBe(false);
  });

  it('keeps the old copy when it stops after the new one is written', () => {
    expect(() => swapSite(src, write, crashAt('written'))).toThrow('crash');
    recoverSiteSwap(src);
    expect(site()).toBe('old');
    expect(existsSync(join(src, '.site-new'))).toBe(false);
  });

  it('puts the old copy back when it stops with the old one aside and the new one not in', () => {
    expect(() => swapSite(src, write, crashAt('aside'))).toThrow('crash');
    expect(existsSync(join(src, 'site'))).toBe(false);
    recoverSiteSwap(src);
    expect(site()).toBe('old');
    expect(existsSync(join(src, '.site-aside'))).toBe(false);
  });

  it('keeps the new copy when it stops before the old one is taken away', () => {
    expect(() => swapSite(src, write, crashAt('moved-in'))).toThrow('crash');
    recoverSiteSwap(src);
    expect(site()).toBe('new');
    expect(existsSync(join(src, '.site-aside'))).toBe(false);
  });

  it('starts every swap by putting the folder back in order', () => {
    expect(() => swapSite(src, write, crashAt('aside'))).toThrow('crash');
    swapSite(src, (dir) => {
      // The old copy is back where the swap expects it before the new one is written.
      expect(readFileSync(join(src, 'site', 'index.css'), 'utf8')).toBe('old');
      write(dir);
    });
    expect(site()).toBe('new');
  });
});
