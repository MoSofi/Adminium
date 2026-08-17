// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACCENTS,
  ACCENTS_DARK,
  accentHex,
  DEFAULT_PREFS,
  DENSITIES,
  DIRS,
  STORAGE_KEYS,
  THEME_ATTRIBUTES,
  THEMES,
  VIZ_PALETTE,
  VIZ_RAMP_ALPHAS,
  preHydrationScript,
} from '../src/index.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const css = (f: string) => readFileSync(join(SRC, f), 'utf8');

describe('axis constants', () => {
  it('exposes the four axes with canonical values', () => {
    expect(THEMES).toEqual(['light', 'dark', 'system']);
    expect(DENSITIES).toEqual(['comfortable', 'compact']);
    expect(DIRS).toEqual(['ltr', 'rtl']);
    expect(Object.keys(ACCENTS)).toEqual([
      'indigo', 'blue', 'teal', 'violet', 'rose', 'red', 'orange', 'black',
    ]);
    expect(ACCENTS.indigo).toBe('#4f46e5');
    expect(DEFAULT_PREFS).toEqual({
      theme: 'system', accent: 'indigo', density: 'comfortable', locale: 'en_US',
    });
  });

  it('viz palette matches research/design-system.md §1.3', () => {
    expect(VIZ_PALETTE).toHaveLength(8);
    expect(VIZ_PALETTE[0]).toBe('#4f46e5');
    expect(VIZ_RAMP_ALPHAS).toEqual([0.12, 0.28, 0.45, 0.65, 0.85, 1]);
  });
});

describe('CSS files agree with the JS constants', () => {
  it('every accent palette exists in accents.css with its light hex and a dark sibling', () => {
    const accents = css('accents.css');
    for (const [name, hex] of Object.entries(ACCENTS)) {
      expect(accents, `accent ${name}`).toContain(`[data-accent="${name}"]`);
      expect(accents, `accent ${name} hex`).toContain(`--accent-light: ${hex}`);
    }
    // Each accent carries a per-theme pair, and the theme — not any component — picks one.
    expect(accents.match(/--accent-dark:/g)).toHaveLength(Object.keys(ACCENTS).length);
    expect(accents).toContain('--accent: var(--accent-light)');
    expect(accents).toContain('--accent: var(--accent-dark)');
    // The JS mirror of the dark half must not drift from the CSS: anything that paints an
    // accent outside CSS (swatches, charts, docs) reads it, and `black` differs wildly.
    for (const [name, hex] of Object.entries(ACCENTS_DARK)) {
      expect(accents, `accent ${name} dark hex`).toContain(`--accent-dark: ${hex}`);
    }
    expect(Object.keys(ACCENTS_DARK)).toEqual(Object.keys(ACCENTS));
    expect(accentHex('black', 'light')).toBe('#111111');
    expect(accentHex('black', 'dark')).toBe('#c9c9d4');
  });

  it('tokens.css carries the independently authored dark NEUTRAL palette', () => {
    const tokens = css('tokens.css');
    expect(tokens).toContain('[data-theme="dark"]');
    // spot values from research/design-system.md §1.1
    expect(tokens).toContain('--bg: #f6f6f8'); // light
    expect(tokens).toContain('--bg: #0a0a0d'); // dark
    expect(tokens).toContain('--pos: #0b7d59'); // light success (AA-tuned on --pos-soft)
    expect(tokens).toContain('--pos: #3ecf8e'); // dark success
    expect(tokens).toMatch(/color-scheme:\s*light/);
    expect(tokens).toMatch(/color-scheme:\s*dark/);
  });

  it('viz.css exposes --viz-1..8 and the 6-step ramp', () => {
    const viz = css('viz.css');
    for (let i = 1; i <= 8; i++) expect(viz).toContain(`--viz-${i}`);
    for (let i = 1; i <= 6; i++) expect(viz).toContain(`--viz-ramp-${i}`);
  });

  it('density.css defines both densities with the density vars', () => {
    const density = css('density.css');
    for (const d of DENSITIES) expect(density).toContain(`[data-density="${d}"]`);
    for (const v of ['--row-py', '--cell-fs', '--card-pad', '--main-pad']) {
      expect(density).toContain(v);
    }
  });

  it('fonts.css switches the body family per lang, matching the tags ThemeProvider stamps (10-i18n-theming.md §5.1)', () => {
    const fonts = css('fonts.css');
    // The three shipped faces plus the locale stacks.
    for (const face of ['Manrope', 'JetBrains Mono', 'IBM Plex Sans Arabic']) {
      expect(fonts).toContain(`font-family: "${face}"`);
    }
    for (const v of ['--font-sans', '--font-mono', '--font-arabic']) expect(fonts).toContain(v);
    // ThemeProvider/pre-hydration stamp BCP-47 tags on <html lang>; these
    // selectors must match those tags exactly or the stacks never activate.
    expect(fonts).toContain('html[lang="ar-EG"] body { font-family: var(--font-arabic); }');
    expect(fonts).toMatch(/html\[lang="zh-CN"\] body \{ font-family: [^;]*"PingFang SC"/);
    expect(fonts).toMatch(/html\[lang="zh-TW"\] body \{ font-family: [^;]*"PingFang TC"/);
    // Arabic face stays scoped to the Arabic block so Latin glyphs fall back to Manrope.
    expect(fonts).toMatch(/IBM Plex Sans Arabic[\s\S]*?unicode-range: U\+0600-06FF/);
  });

  it('index.css imports every sheet except tailwind.css', () => {
    const index = css('index.css');
    for (const f of ['tokens', 'accents', 'density', 'viz', 'fonts', 'motion', 'exceptions']) {
      expect(index).toContain(`@import "./${f}.css"`);
    }
    expect(index).not.toMatch(/@import\s+["'][^"']*tailwind\.css/);
  });
});

describe('preHydrationScript', () => {
  it('is a self-contained IIFE using the canonical storage keys and defaults', () => {
    expect(preHydrationScript.startsWith('(function(){')).toBe(true);
    expect(preHydrationScript.endsWith('})();')).toBe(true);
    // stays in sync with STORAGE_KEYS / DEFAULT_PREFS / THEME_ATTRIBUTES
    for (const key of [STORAGE_KEYS.theme, STORAGE_KEYS.accent, STORAGE_KEYS.density, STORAGE_KEYS.dir, STORAGE_KEYS.locale]) {
      expect(preHydrationScript).toContain(`"${key}"`);
    }
    for (const attr of [THEME_ATTRIBUTES.theme, THEME_ATTRIBUTES.accent, THEME_ATTRIBUTES.density]) {
      expect(preHydrationScript).toContain(`"${attr}"`);
    }
    expect(preHydrationScript).toContain(`"${DEFAULT_PREFS.accent}"`);
    expect(preHydrationScript).toContain(`"${DEFAULT_PREFS.density}"`);
    expect(preHydrationScript).toContain('prefers-color-scheme: dark');
    // storage failures (private mode) must be swallowed
    expect(preHydrationScript).toContain('catch');
    // no newlines/backticks — must be safely inline-able in a <script> tag
    expect(preHydrationScript).not.toMatch(/[\n`]/);
    expect(preHydrationScript).not.toContain('</script');
  });

  it('matches its snapshot (change deliberately, in sync with docs)', () => {
    expect(preHydrationScript).toMatchSnapshot();
  });
});
