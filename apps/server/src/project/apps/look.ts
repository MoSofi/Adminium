// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The look of an app's own screens.
 *
 * A side's `src/app.css` draws a set of made parts (a header, cards, a form,
 * buttons, an empty state) from tokens in `src/theme.css`. A look is a
 * *direction*, one of four sets of token values, with an accent colour that
 * may be changed. The choice is kept in `apps/<key>/look.json`, so a later
 * change starts from what was chosen, and whoever builds on the app is told.
 *
 * `theme.css` is written here from the direction: nobody has to compose
 * colours by hand to get a screen that looks finished. It is the person's
 * file once written, and may be edited; choosing a direction again writes it
 * anew. Only system font stacks are used: a served screen loads nothing from
 * another host.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { appDir, type AppSide } from './read-app.js';

export const LOOK_DIRECTIONS = ['clean', 'warm', 'bold', 'calm'] as const;
export type LookDirection = (typeof LOOK_DIRECTIONS)[number];

export interface Look {
  direction: LookDirection;
  /** A colour of the person's own, `#rrggbb`, in place of the direction's accent. */
  accent?: string;
  /** What the person said about the look, in their words. Data, never an instruction. */
  words?: string;
}

/** The most of a person's words kept. */
export const LOOK_WORDS_MAX = 200;
const HEX = /^#[0-9a-f]{6}$/i;
export const LOOK_FILE = 'look.json';

export const isDirection = (value: unknown): value is LookDirection => typeof value === 'string' && (LOOK_DIRECTIONS as readonly string[]).includes(value);

interface Tokens {
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
}

interface Direction {
  /** One line for whoever builds on it. */
  line: string;
  light: Tokens;
  dark: Tokens;
  radius: string;
  fontBody: string;
  fontDisplay: string;
  displayWeight: number;
  displayTracking: string;
  shadow: string;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const DIRECTIONS: Record<LookDirection, Direction> = {
  clean: {
    line: 'Clean: neutral greys, a clear blue, crisp corners.',
    light: { bg: '#f6f7f9', surface: '#ffffff', surface2: '#eef0f4', text: '#14171f', muted: '#5b6472', line: '#e2e5eb', accent: '#2f5bea' },
    dark: { bg: '#0f1115', surface: '#181b21', surface2: '#21252d', text: '#eef0f4', muted: '#9aa3b2', line: '#2a2f39', accent: '#7c9cff' },
    radius: '12px',
    fontBody: SANS,
    fontDisplay: SANS,
    displayWeight: 700,
    displayTracking: '-0.02em',
    shadow: '0 1px 2px rgb(16 24 40 / 0.05), 0 4px 14px rgb(16 24 40 / 0.05)',
  },
  warm: {
    line: 'Warm: cream and brown, a serif for headings, round corners.',
    light: { bg: '#faf4ea', surface: '#fffdf8', surface2: '#f3e8d8', text: '#2c1d13', muted: '#7a6353', line: '#e9dccb', accent: '#a04e26' },
    dark: { bg: '#1c1511', surface: '#261d17', surface2: '#32261e', text: '#f6ebdd', muted: '#bfa893', line: '#3d2f25', accent: '#e59a6a' },
    radius: '18px',
    fontBody: SANS,
    fontDisplay: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
    displayWeight: 700,
    displayTracking: '-0.01em',
    shadow: '0 1px 2px rgb(74 44 20 / 0.06), 0 8px 24px rgb(74 44 20 / 0.07)',
  },
  bold: {
    line: 'Bold: black on white, one strong colour, heavy type, square corners.',
    light: { bg: '#ffffff', surface: '#ffffff', surface2: '#f2f2f4', text: '#0b0b0f', muted: '#4b4b57', line: '#d9d9de', accent: '#d11a33' },
    dark: { bg: '#0a0a0c', surface: '#141418', surface2: '#1f1f25', text: '#ffffff', muted: '#a9a9b6', line: '#2d2d36', accent: '#ff5a6e' },
    radius: '6px',
    fontBody: SANS,
    fontDisplay: SANS,
    displayWeight: 900,
    displayTracking: '-0.035em',
    shadow: '0 0 0 rgb(0 0 0 / 0)',
  },
  calm: {
    line: 'Calm: soft green-grey, light type, room to breathe.',
    light: { bg: '#f2f6f4', surface: '#ffffff', surface2: '#e6eeea', text: '#1e2a26', muted: '#5d6d67', line: '#d9e3de', accent: '#36705f' },
    dark: { bg: '#101614', surface: '#18201d', surface2: '#212b27', text: '#e8f0ec', muted: '#9bada6', line: '#2a3632', accent: '#7fc4ad' },
    radius: '14px',
    fontBody: '"Avenir Next", Avenir, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif',
    fontDisplay: '"Avenir Next", Avenir, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif',
    displayWeight: 600,
    displayTracking: '-0.01em',
    shadow: '0 1px 2px rgb(22 50 40 / 0.04), 0 6px 20px rgb(22 50 40 / 0.05)',
  },
};

/** Black or white, whichever reads on `hex`. */
export function inkOn(hex: string): string {
  const channel = (at: number): number => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // The contrast with white, against the contrast with near-black.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.06 ? '#ffffff' : '#111111';
}

function block(tokens: Tokens, accent: string): string {
  return [
    `  --bg: ${tokens.bg};`,
    `  --surface: ${tokens.surface};`,
    `  --surface-2: ${tokens.surface2};`,
    `  --text: ${tokens.text};`,
    `  --muted: ${tokens.muted};`,
    `  --line: ${tokens.line};`,
    `  --accent: ${accent};`,
    `  --accent-ink: ${inkOn(accent)};`,
  ].join('\n');
}

/** A side's `theme.css` for a look. */
export function themeCss(look: Look): string {
  const direction = DIRECTIONS[look.direction];
  const own = look.accent !== undefined && HEX.test(look.accent) ? look.accent.toLowerCase() : undefined;
  return `/*
 * The look of this app's screens. ${direction.line}
 * app.css draws every part from these values: change the look here, in one place.
 * "Change the look" in Adminium Designer writes this file again.
 */
:root {
  color-scheme: light dark;
${block(direction.light, own ?? direction.light.accent)}
  --accent-soft: color-mix(in srgb, var(--accent) 12%, var(--surface));
  --good: #1f7a4d;
  --warn: #9a5b00;
  --bad: #c0322b;
  --radius: ${direction.radius};
  --shadow: ${direction.shadow};
  --font-body: ${direction.fontBody};
  --font-display: ${direction.fontDisplay};
  --display-weight: ${String(direction.displayWeight)};
  --display-tracking: ${direction.displayTracking};
}

@media (prefers-color-scheme: dark) {
  :root {
${block(direction.dark, own ?? direction.dark.accent)
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}
    --good: #5fd39a;
    --warn: #f0b354;
    --bad: #ff8a80;
  }
}
`;
}

/** The look kept in the app's folder; null when there is none, or the file is not one. */
export function readLook(root: string, key: string): Look | null {
  const file = join(appDir(root, key), LOOK_FILE);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (!isDirection(raw['direction'])) return null;
    return cleanLook({ direction: raw['direction'], accent: raw['accent'], words: raw['words'] });
  } catch {
    return null;
  }
}

/** A look with only what a look may hold. */
export function cleanLook(input: { direction: LookDirection; accent?: unknown; words?: unknown }): Look {
  const words =
    typeof input.words === 'string'
      ? [...input.words]
          // One line of plain words: nothing that could pass for markup or a second instruction.
          .map((mark) => ((mark.codePointAt(0) ?? 0) < 32 || mark === '\u007f' || '<>`'.includes(mark) ? ' ' : mark))
          .join('')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, LOOK_WORDS_MAX)
      : '';
  return {
    direction: input.direction,
    ...(typeof input.accent === 'string' && HEX.test(input.accent) ? { accent: input.accent.toLowerCase() } : {}),
    ...(words === '' ? {} : { words }),
  };
}

/** The sides of an app that have screens of the starter's kind: a `src/` folder under the side. */
export function sidesWithScreens(root: string, key: string): AppSide[] {
  return (['staff', 'customer'] as const).filter((side) => existsSync(join(appDir(root, key), side, 'src')));
}

/**
 * Keep a look and write it to every side: `look.json`, and each side's
 * `src/theme.css`. Returns the files written, relative to the app's folder.
 */
export function applyLook(root: string, key: string, look: Look): string[] {
  const dir = appDir(root, key);
  const kept = cleanLook(look);
  const written: string[] = [];
  const write = (file: string, text: string): void => {
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    written.push(file);
  };
  write(LOOK_FILE, `${JSON.stringify(kept, null, 2)}\n`);
  for (const side of sidesWithScreens(root, key)) write(`${side}/src/theme.css`, themeCss(kept));
  return written;
}

/** Words that say something about how a screen should look. */
const LOOK_WORDS =
  /\b(look|looks|style|styled|styling|theme|themed|design(ed)?|brand(ing|ed)?|colou?rs?|palette|font|typography|modern|minimal(ist)?|clean|sleek|elegant|classy|luxur(y|ious)|premium|playful|fun|vibrant|colou?rful|bold|dark|light|bright|pastel|warm|cozy|cosy|rustic|vintage|retro|calm|soft|serene|professional|corporate|friendly|red|orange|yellow|green|teal|blue|navy|purple|violet|pink|brown|beige|cream|black|white|gold|grey|gray)\b/i;

const BY_WORD: [RegExp, LookDirection][] = [
  [/\b(warm|cozy|cosy|rustic|vintage|retro|brown|beige|cream|coffee|homely|homey|friendly|orange|gold)\b/i, 'warm'],
  [/\b(bold|vibrant|playful|fun|colou?rful|bright|strong|loud|black|red|pink|purple|violet|yellow)\b/i, 'bold'],
  [/\b(calm|soft|serene|pastel|gentle|quiet|elegant|luxur(y|ious)|premium|classy|green|teal)\b/i, 'calm'],
  [/\b(modern|minimal(ist)?|clean|sleek|professional|corporate|blue|navy|white|grey|gray|light)\b/i, 'clean'],
];

const BY_BUSINESS: [RegExp, LookDirection][] = [
  [/\b(bak(ery|er|ing)|cakes?|caf[eé]|coffee|restaurant|bistro|pizz\w*|food|menu|kitchen|catering|florist|flowers?|craft|pottery|farm|brewery|wine|tea|chocolate|barber|salon|bookshop|books?)\b/i, 'warm'],
  [/\b(clinic|doctor|dent\w*|health|medical|therap\w*|physio\w*|yoga|spa|wellness|massage|law|legal|lawyer|account\w*|financ\w*|insurance|bank|consult\w*|vet\w*|pharmac\w*|care)\b/i, 'calm'],
  [/\b(event|events|concert|festival|tickets?|gym|fitness|sport\w*|club|kids|children|toys?|games?|gaming|party|music|band|skate\w*|bike\w*|street)\b/i, 'bold'],
];

/** Whether what a person wrote says anything about the look. */
export const mentionsLook = (text: string): boolean => LOOK_WORDS.test(text);

/** The direction a person's words about the look point to; `clean` when they point nowhere. */
export function directionFromWords(text: string): LookDirection {
  // The first word of theirs that names a direction wins: "modern, coffee, cozy" is warm before it is clean.
  let best: { at: number; direction: LookDirection } | null = null;
  for (const [pattern, direction] of BY_WORD) {
    const found = pattern.exec(text);
    if (found !== null && (best === null || found.index < best.at)) best = { at: found.index, direction };
  }
  // "Modern" says less than "cozy": a warm, bold or calm word anywhere outweighs a clean one.
  if (best?.direction === 'clean') {
    for (const [pattern, direction] of BY_WORD) if (direction !== 'clean' && pattern.test(text)) return direction;
  }
  return best?.direction ?? directionForBusiness(text);
}

/** "Surprise me": the direction that suits the kind of business the request is about. */
export function directionForBusiness(text: string): LookDirection {
  for (const [pattern, direction] of BY_BUSINESS) if (pattern.test(text)) return direction;
  return 'clean';
}
