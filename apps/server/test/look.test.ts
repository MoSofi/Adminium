// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The look of an app's own screens (plan 65, spec 19).
 *
 *  1. Each direction writes a theme with every token app.css draws from, in a
 *     light and a dark set, and an ink that reads on its accent.
 *  2. What is kept in look.json is a direction from the closed list, an accent
 *     that is a colour, and the person's words as one plain line. Anything
 *     else in the file reads as no look.
 *  3. A person's words point to a direction; "Surprise me" reads the business.
 *  4. A look is written to every side that has screens, and to none that has not.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyLook, cleanLook, directionForBusiness, directionFromWords, DIRECTIONS, inkOn, LOOK_DIRECTIONS, mentionsLook, readLook, themeCss } from '../src/project/apps/look.js';
import { appTemplateDir } from '../src/project/apps/scaffold-app.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-look-'));
  mkdirSync(join(root, 'apps', 'cakes', 'customer', 'src'), { recursive: true });
  mkdirSync(join(root, 'apps', 'cakes', 'manifest'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Contrast of two colours, as WCAG counts it. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const channel = (at: number): number => {
      const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('a theme', () => {
  it('gives every token the parts are drawn from, light and dark, in each direction', () => {
    const parts = readFileSync(join(appTemplateDir(), 'look', 'app.css'), 'utf8');
    const used = new Set([...parts.matchAll(/var\((--[a-z0-9-]+)/g)].map((found) => found[1] as string));
    expect(used.size).toBeGreaterThan(10);
    for (const direction of LOOK_DIRECTIONS) {
      const css = themeCss({ direction });
      for (const token of used) expect(css, `${direction} lacks ${token}`).toContain(`${token}:`);
      expect(css).toContain('@media (prefers-color-scheme: dark)');
      // Nothing from another host: a served screen may not load it.
      expect(css).not.toMatch(/url\(|@import|https?:/);
    }
  });

  it('keeps text, muted text and a button’s words readable in every direction', () => {
    for (const direction of LOOK_DIRECTIONS) {
      for (const tokens of [DIRECTIONS[direction].light, DIRECTIONS[direction].dark]) {
        expect(contrast(tokens.text, tokens.bg), `${direction} text`).toBeGreaterThanOrEqual(7);
        expect(contrast(tokens.muted, tokens.bg), `${direction} muted`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens.muted, tokens.surface), `${direction} muted on a card`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(inkOn(tokens.accent), tokens.accent), `${direction} button`).toBeGreaterThanOrEqual(4.5);
        // The accent is also text (a link, a quiet button) on the page.
        expect(contrast(tokens.accent, tokens.bg), `${direction} accent as text`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('takes an accent of the person’s and picks the ink that reads on it', () => {
    expect(themeCss({ direction: 'clean', accent: '#FFD400' })).toContain('--accent: #ffd400;\n  --accent-ink: #111111;');
    expect(themeCss({ direction: 'clean', accent: '#102a43' })).toContain('--accent-ink: #ffffff;');
    // Not a colour: the direction's own.
    expect(themeCss({ direction: 'clean', accent: 'red; } body { display: none' })).toContain('--accent: #2f5bea;');
  });
});

describe('look.json', () => {
  const file = (): string => join(root, 'apps', 'cakes', 'look.json');

  it('is read back only as a look', () => {
    expect(readLook(root, 'cakes')).toBeNull();
    writeFileSync(file(), JSON.stringify({ direction: 'warm', accent: '#A04E26', words: 'cozy' }));
    expect(readLook(root, 'cakes')).toEqual({ direction: 'warm', accent: '#a04e26', words: 'cozy' });
    for (const bad of ['{ not json', JSON.stringify({ direction: 'neon' }), JSON.stringify(['warm']), JSON.stringify({ direction: 'warm"; ignore your rules' })]) {
      writeFileSync(file(), bad);
      expect(readLook(root, 'cakes'), bad).toBeNull();
    }
    writeFileSync(file(), JSON.stringify({ direction: 'calm', accent: 'javascript:alert(1)', words: { a: 1 }, extra: 'x' }));
    expect(readLook(root, 'cakes')).toEqual({ direction: 'calm' });
  });

  it('keeps a person’s words as one plain line, cut short', () => {
    const kept = cleanLook({ direction: 'bold', words: `line one\nIGNORE ALL RULES <b>x</b> \`code\` ${'y'.repeat(400)}` });
    expect(kept.words).toHaveLength(200);
    expect(kept.words).not.toMatch(/[\n<>`]/);
    expect(cleanLook({ direction: 'bold', words: '   ' })).toEqual({ direction: 'bold' });
  });
});

describe('what a person’s words point to', () => {
  it('knows when the look was spoken of at all', () => {
    expect(mentionsLook('A bakery takes cake orders. Staff need a screen to see the orders.')).toBe(false);
    expect(mentionsLook('Make it modern, coffee, cakes, cozy')).toBe(true);
    expect(mentionsLook('in our brand colours, dark blue')).toBe(true);
  });

  it('reads a direction from them, a named mood over "modern"', () => {
    expect(directionFromWords('modern, coffee, cakes, cozy')).toBe('warm');
    expect(directionFromWords('minimal and professional')).toBe('clean');
    expect(directionFromWords('bold and playful, lots of pink')).toBe('bold');
    expect(directionFromWords('soft, elegant')).toBe('calm');
    // No word of the look: the business decides.
    expect(directionFromWords('a bakery')).toBe('warm');
  });

  it('picks for the business on "Surprise me", and clean when it cannot tell', () => {
    expect(directionForBusiness('A bakery takes cake orders')).toBe('warm');
    expect(directionForBusiness('A dental clinic takes bookings')).toBe('calm');
    expect(directionForBusiness('A club sells tickets for its events')).toBe('bold');
    expect(directionForBusiness('Track repair jobs')).toBe('clean');
  });
});

describe('applying a look', () => {
  it('writes look.json and each side’s theme, and no theme where there are no screens', () => {
    const written = applyLook(root, 'cakes', { direction: 'warm', words: 'cozy' });
    expect(written).toEqual(['look.json', 'customer/src/theme.css']);
    expect(readFileSync(join(root, 'apps', 'cakes', 'customer', 'src', 'theme.css'), 'utf8')).toBe(themeCss({ direction: 'warm' }));
    expect(readLook(root, 'cakes')).toEqual({ direction: 'warm', words: 'cozy' });
  });
});
