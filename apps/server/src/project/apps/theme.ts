// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A theme: the values a style gives an app's own screens.
 *
 * A design skill's `theme.json` holds one, and an app's `look.json` may hold
 * changes on top of it. Both are read by `cleanTheme`, so a value that is not
 * one never reaches a stylesheet. `themeCssOf` writes a side's `theme.css`
 * from a theme: colours for light and dark, the two fonts with their
 * fallbacks, a type scale, a spacing scale, corners and shadows.
 *
 * Contrast is made right here, not asked of whoever wrote the theme: the ink
 * on a colour is black or white, whichever reads, and text that does not
 * reach 4.5:1 on its background is moved until it does.
 */

export const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export interface ThemeColours {
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  accent2: string;
  band: string;
}
export const COLOUR_KEYS = ['bg', 'surface', 'surface2', 'text', 'muted', 'line', 'accent', 'accent2', 'band'] as const;

export const FONT_FALLBACKS = ['serif', 'sans', 'mono', 'rounded'] as const;
export type FontFallback = (typeof FONT_FALLBACKS)[number];

export interface ThemeFont {
  /** A family of Google's catalogue, or of the person's own files; absent for the system's. */
  family?: string;
  weights: number[];
  fallback: FontFallback;
}

export const SPACES = ['compact', 'regular', 'roomy'] as const;
export const SHADOWS = ['none', 'soft', 'strong'] as const;

export interface Theme {
  /** `dark`: the page is dark whatever the visitor's setting. */
  scheme: 'both' | 'dark';
  light: ThemeColours;
  dark: ThemeColours;
  fonts: { heading: ThemeFont; body: ThemeFont };
  headingWeight: number;
  /** The heading's weight while its font is not installed and the system's stands in. */
  fallbackWeight: number;
  headingTracking: string;
  typeScale: number;
  space: (typeof SPACES)[number];
  radius: number;
  shadow: (typeof SHADOWS)[number];
}

/** A theme with any of its values left out: what a brief changes. */
export type ThemePatch = {
  scheme?: Theme['scheme'];
  light?: Partial<ThemeColours>;
  dark?: Partial<ThemeColours>;
  fonts?: { heading?: Partial<ThemeFont>; body?: Partial<ThemeFont> };
} & Partial<Pick<Theme, 'headingWeight' | 'fallbackWeight' | 'headingTracking' | 'typeScale' | 'space' | 'radius' | 'shadow'>>;

const STACKS: Record<FontFallback, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif',
};

/** A family's name: letters, digits and single spaces, as Google's catalogue names them. */
export const FONT_FAMILY = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+){0,5}$/;

/** Whether a text is a font family's name as a theme may hold one. */
export const isPublicFontName = (family: string): boolean => FONT_FAMILY.test(family) && family.length <= 40;

/** The package Google's catalogue ships a family as: `Playfair Display` → `@fontsource/playfair-display`. */
export const fontPackage = (family: string): string => `@fontsource/${family.toLowerCase().split(' ').join('-')}`;

export const BASE_THEME: Theme = {
  scheme: 'both',
  light: { bg: '#f6f7f9', surface: '#ffffff', surface2: '#eef0f4', text: '#14171f', muted: '#5b6472', line: '#e2e5eb', accent: '#2f5bea', accent2: '#0f766e', band: '#14213d' },
  dark: { bg: '#0f1115', surface: '#181b21', surface2: '#21252d', text: '#eef0f4', muted: '#9aa3b2', line: '#2a2f39', accent: '#7c9cff', accent2: '#5eead4', band: '#181b21' },
  fonts: { heading: { weights: [700], fallback: 'sans' }, body: { weights: [400, 600], fallback: 'sans' } },
  headingWeight: 700,
  fallbackWeight: 700,
  headingTracking: '-0.02em',
  typeScale: 1.25,
  space: 'regular',
  radius: 12,
  shadow: 'soft',
};

// ── colour arithmetic ───────────────────────────────────────────────────────

type Rgb = [number, number, number];
const rgbOf = (hex: string): Rgb => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
const hexOf = (rgb: Rgb): string => `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;

/** `amount` of the way from `from` to `to`, 0 to 1. */
export function mix(from: string, to: string, amount: number): string {
  const a = rgbOf(from);
  const b = rgbOf(to);
  return hexOf([a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]);
}

export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads on `hex`. */
export function inkOn(hex: string): string {
  return contrast('#ffffff', hex) >= contrast('#111111', hex) ? '#ffffff' : '#111111';
}

/** `colour`, moved toward black or white until it reaches `ratio` on `on`. */
export function readable(colour: string, on: string, ratio: number): string {
  if (contrast(colour, on) >= ratio) return colour;
  const toward = luminance(on) > 0.4 ? '#000000' : '#ffffff';
  for (let step = 1; step <= 20; step += 1) {
    const moved = mix(colour, toward, step / 20);
    if (contrast(moved, on) >= ratio) return moved;
  }
  return toward;
}

/** A dark set made from a light one: the same hues, the page dark. */
function darkFrom(light: ThemeColours): ThemeColours {
  const bg = mix(light.text, '#0b0b0d', 0.82);
  const text = mix(light.bg, '#ffffff', 0.35);
  return {
    bg,
    surface: mix(bg, '#ffffff', 0.05),
    surface2: mix(bg, '#ffffff', 0.1),
    text,
    muted: mix(text, bg, 0.38),
    line: mix(bg, '#ffffff', 0.15),
    accent: mix(light.accent, '#ffffff', 0.3),
    accent2: mix(light.accent2, '#ffffff', 0.3),
    band: mix(bg, '#000000', 0.35),
  };
}

// ── reading ─────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const hex = (value: unknown): string | undefined => (typeof value === 'string' && HEX_COLOUR.test(value) ? value.toLowerCase() : undefined);
const numberIn = (value: unknown, low: number, high: number): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high ? value : undefined);

function cleanColours(input: unknown, notes: string[], where: string): Partial<ThemeColours> {
  const out: Partial<ThemeColours> = {};
  if (!isRecord(input)) return out;
  for (const key of COLOUR_KEYS) {
    if (input[key] === undefined) continue;
    const colour = hex(input[key]);
    if (colour === undefined) notes.push(`${where}.${key} is not a colour as #rrggbb, and was left out.`);
    else out[key] = colour;
  }
  return out;
}

function cleanFont(input: unknown, notes: string[], where: string): Partial<ThemeFont> {
  const out: Partial<ThemeFont> = {};
  if (!isRecord(input)) return out;
  if (input['family'] !== undefined) {
    const family = typeof input['family'] === 'string' ? input['family'].trim().replace(/\s+/g, ' ') : '';
    if (FONT_FAMILY.test(family) && family.length <= 40) out.family = family;
    else notes.push(`${where}.family is not a font's name, and was left out.`);
  }
  if (Array.isArray(input['weights'])) {
    const weights = [...new Set(input['weights'].filter((weight): weight is number => typeof weight === 'number' && weight >= 100 && weight <= 900 && weight % 100 === 0))].sort((a, b) => a - b).slice(0, 4);
    if (weights.length > 0) out.weights = weights;
  }
  if ((FONT_FALLBACKS as readonly unknown[]).includes(input['fallback'])) out.fallback = input['fallback'] as FontFallback;
  return out;
}

/** What of `input` is a theme's, with a note for each value that was not. Nothing else passes. */
export function cleanThemePatch(input: unknown): { patch: ThemePatch; notes: string[] } {
  const notes: string[] = [];
  const patch: ThemePatch = {};
  if (!isRecord(input)) return { patch, notes };
  if (input['scheme'] === 'dark' || input['scheme'] === 'both') patch.scheme = input['scheme'];
  const light = cleanColours(input['light'], notes, 'light');
  if (Object.keys(light).length > 0) patch.light = light;
  const dark = cleanColours(input['dark'], notes, 'dark');
  if (Object.keys(dark).length > 0) patch.dark = dark;
  if (isRecord(input['fonts'])) {
    const heading = cleanFont(input['fonts']['heading'], notes, 'fonts.heading');
    const body = cleanFont(input['fonts']['body'], notes, 'fonts.body');
    if (Object.keys(heading).length > 0 || Object.keys(body).length > 0) {
      patch.fonts = { ...(Object.keys(heading).length > 0 ? { heading } : {}), ...(Object.keys(body).length > 0 ? { body } : {}) };
    }
  }
  const weight = (value: unknown): number | undefined => (typeof value === 'number' && value >= 100 && value <= 900 && value % 100 === 0 ? value : undefined);
  const headingWeight = weight(input['headingWeight']);
  if (headingWeight !== undefined) patch.headingWeight = headingWeight;
  const fallbackWeight = weight(input['fallbackWeight']);
  if (fallbackWeight !== undefined) patch.fallbackWeight = fallbackWeight;
  if (typeof input['headingTracking'] === 'string' && /^-?0(\.\d{1,3})?em$/.test(input['headingTracking'])) patch.headingTracking = input['headingTracking'];
  const typeScale = numberIn(input['typeScale'], 1.125, 1.5);
  if (typeScale !== undefined) patch.typeScale = typeScale;
  if ((SPACES as readonly unknown[]).includes(input['space'])) patch.space = input['space'] as Theme['space'];
  const radius = numberIn(input['radius'], 0, 32);
  if (radius !== undefined) patch.radius = Math.round(radius);
  if ((SHADOWS as readonly unknown[]).includes(input['shadow'])) patch.shadow = input['shadow'] as Theme['shadow'];
  for (const key of ['typeScale', 'radius', 'space', 'shadow', 'headingWeight', 'headingTracking'] as const) {
    if (input[key] !== undefined && patch[key] === undefined) notes.push(`${key} is not a value a theme takes, and was left out.`);
  }
  return { patch, notes };
}

/** One patch on another: the later one's values win, value by value. */
export function mergePatches(...patches: readonly ThemePatch[]): ThemePatch {
  const out: ThemePatch = {};
  for (const patch of patches) {
    const { light, dark, fonts, ...rest } = patch;
    Object.assign(out, rest);
    if (light !== undefined) out.light = { ...out.light, ...light };
    if (dark !== undefined) out.dark = { ...out.dark, ...dark };
    if (fonts !== undefined) {
      out.fonts = {
        ...out.fonts,
        ...(fonts.heading === undefined ? {} : { heading: { ...out.fonts?.heading, ...fonts.heading } }),
        ...(fonts.body === undefined ? {} : { body: { ...out.fonts?.body, ...fonts.body } }),
      };
    }
  }
  return out;
}

/**
 * A whole theme from patches, the later over the earlier, over the base.
 * `accent` is a person's one colour, and wins over all of them.
 */
export function themeFrom(patches: readonly ThemePatch[], accent?: string): Theme {
  const patch = mergePatches(...patches);
  const base = BASE_THEME;
  const lightGiven = patch.light ?? {};
  const light: ThemeColours = { ...base.light, ...lightGiven };
  // A second accent and a band that were not given follow what was: the accent, and the text.
  if (lightGiven.accent2 === undefined && lightGiven.accent !== undefined) light.accent2 = light.accent;
  if (lightGiven.band === undefined && lightGiven.text !== undefined) light.band = light.text;
  const scheme = patch.scheme ?? base.scheme;
  // A dark set that was not given is made from the light one; a dark-only theme is its light set.
  const dark: ThemeColours = scheme === 'dark' ? { ...light } : { ...(patch.light === undefined ? base.dark : darkFrom(light)), ...(patch.dark ?? {}) };
  const own = accent !== undefined && HEX_COLOUR.test(accent) ? accent.toLowerCase() : undefined;
  if (own !== undefined) {
    light.accent = own;
    dark.accent = scheme === 'dark' ? own : luminance(own) < 0.25 ? mix(own, '#ffffff', 0.3) : own;
  }
  for (const set of [light, dark]) {
    set.text = readable(set.text, set.bg, 7);
    set.muted = readable(set.muted, set.bg, 4.5);
    // The accent is also the colour of links and small marks on the page: it must read there.
    set.accent = readable(set.accent, set.bg, 3);
  }
  const font = (given: Partial<ThemeFont> | undefined, fallback: ThemeFont): ThemeFont => ({
    ...(given?.family === undefined ? (fallback.family === undefined ? {} : { family: fallback.family }) : { family: given.family }),
    weights: given?.weights ?? fallback.weights,
    fallback: given?.fallback ?? fallback.fallback,
  });
  const heading = font(patch.fonts?.heading, base.fonts.heading);
  const headingWeight = patch.headingWeight ?? heading.weights[heading.weights.length - 1] ?? base.headingWeight;
  return {
    scheme,
    light,
    dark,
    fonts: { heading, body: font(patch.fonts?.body, base.fonts.body) },
    headingWeight,
    // A light display face (weight 400) falls back to a system face that needs weight to be a heading.
    fallbackWeight: patch.fallbackWeight ?? Math.max(headingWeight, 600),
    headingTracking: patch.headingTracking ?? base.headingTracking,
    typeScale: patch.typeScale ?? base.typeScale,
    space: patch.space ?? base.space,
    radius: patch.radius ?? base.radius,
    shadow: patch.shadow ?? base.shadow,
  };
}

/** The families a theme names, each once, with the weights asked of it. */
export function themeFamilies(theme: Theme): { family: string; weights: number[]; use: 'heading' | 'body' }[] {
  const out = new Map<string, { family: string; weights: Set<number>; use: 'heading' | 'body' }>();
  for (const use of ['heading', 'body'] as const) {
    const font = theme.fonts[use];
    if (font.family === undefined) continue;
    const held = out.get(font.family) ?? { family: font.family, weights: new Set<number>(), use };
    for (const weight of font.weights) held.weights.add(weight);
    if (use === 'heading') held.weights.add(theme.headingWeight);
    out.set(font.family, held);
  }
  return [...out.values()].map((entry) => ({ family: entry.family, weights: [...entry.weights].sort((a, b) => a - b), use: entry.use }));
}

// ── writing ─────────────────────────────────────────────────────────────────

const SHADOW: Record<Theme['shadow'], [string, string]> = {
  none: ['0 0 0 rgb(0 0 0 / 0)', '0 0 0 rgb(0 0 0 / 0)'],
  soft: ['0 1px 2px rgb(16 24 40 / 0.05), 0 4px 14px rgb(16 24 40 / 0.06)', '0 2px 6px rgb(16 24 40 / 0.06), 0 16px 40px rgb(16 24 40 / 0.1)'],
  strong: ['0 2px 4px rgb(0 0 0 / 0.2), 0 8px 24px rgb(0 0 0 / 0.22)', '0 4px 10px rgb(0 0 0 / 0.25), 0 24px 60px rgb(0 0 0 / 0.35)'],
};
const SPACE_UNIT: Record<Theme['space'], number> = { compact: 0.875, regular: 1, roomy: 1.2 };
const SPACE_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5];
const round = (value: number): string => String(Math.round(value * 1000) / 1000);

function colourBlock(set: ThemeColours, indent: string): string {
  const lines: [string, string][] = [
    ['bg', set.bg],
    ['surface', set.surface],
    ['surface-2', set.surface2],
    ['text', set.text],
    ['muted', set.muted],
    ['line', set.line],
    ['accent', set.accent],
    ['accent-ink', inkOn(set.accent)],
    ['accent-2', set.accent2],
    ['accent-2-ink', inkOn(set.accent2)],
    ['band', set.band],
    ['band-ink', inkOn(set.band)],
  ];
  return lines.map(([name, value]) => `${indent}--${name}: ${value};`).join('\n');
}

const stack = (font: ThemeFont): string => (font.family === undefined ? STACKS[font.fallback] : `"${font.family}", ${STACKS[font.fallback]}`);

export interface ThemeCssOptions {
  /** One line for the file's head: which style this is. */
  line: string;
  /** The families whose files the side carries: a heading keeps its own weight only with its font. */
  installed?: ReadonlySet<string>;
}

/** A side's `theme.css`. */
export function themeCssOf(theme: Theme, opts: ThemeCssOptions): string {
  const scale = theme.typeScale;
  const size = (power: number): number => scale ** power;
  const fluid = (power: number): string => {
    const max = size(power);
    // Large headings shrink on a narrow screen: three quarters of their size at the least.
    return `clamp(${round(max * 0.72)}rem, ${round(max * 0.5)}rem + ${round(max * 1.1)}vw, ${round(max)}rem)`;
  };
  const unit = SPACE_UNIT[theme.space];
  const headingFamily = theme.fonts.heading.family;
  const carried = headingFamily === undefined || (opts.installed?.has(headingFamily) ?? false);
  const [shadow, shadowLarge] = SHADOW[theme.shadow];
  const shared = [
    '  --accent-soft: color-mix(in srgb, var(--accent) 12%, var(--surface));',
    `  --radius: ${String(theme.radius)}px;`,
    `  --radius-sm: ${String(Math.round(theme.radius / 2))}px;`,
    `  --radius-lg: ${String(Math.round(theme.radius * 1.5))}px;`,
    `  --shadow: ${shadow};`,
    `  --shadow-lg: ${shadowLarge};`,
    `  --font-body: ${stack(theme.fonts.body)};`,
    `  --font-display: ${stack(theme.fonts.heading)};`,
    `  --display-weight: ${String(carried ? theme.headingWeight : theme.fallbackWeight)};`,
    `  --display-tracking: ${theme.headingTracking};`,
    `  --text-xs: ${round(size(-2))}rem;`,
    `  --text-sm: ${round(size(-1))}rem;`,
    '  --text-base: 1rem;',
    `  --text-lg: ${round(size(1))}rem;`,
    `  --text-xl: ${round(size(2))}rem;`,
    `  --text-2xl: ${fluid(3)};`,
    `  --text-3xl: ${fluid(4)};`,
    `  --text-4xl: ${fluid(5)};`,
    ...SPACE_STEPS.map((step, index) => `  --space-${String(index + 1)}: ${round(step * unit)}rem;`),
  ].join('\n');
  const darkOnly = theme.scheme === 'dark';
  return `/*
 * The look of this app's screens. ${opts.line}
 * Every part and every screen draws from these values: change the look here, in one place.
 * "Change the style" in Adminium Designer writes this file again.
 */
:root {
  color-scheme: ${darkOnly ? 'dark' : 'light dark'};
${colourBlock(theme.light, '  ')}
  --good: ${darkOnly ? '#5fd39a' : '#1f7a4d'};
  --warn: ${darkOnly ? '#f0b354' : '#9a5b00'};
  --bad: ${darkOnly ? '#ff8a80' : '#c0322b'};
${shared}
}
${
  darkOnly
    ? ''
    : `
@media (prefers-color-scheme: dark) {
  :root {
${colourBlock(theme.dark, '    ')}
    --good: #5fd39a;
    --warn: #f0b354;
    --bad: #ff8a80;
  }
}
`
}`;
}

/** The weights a family's package has a stylesheet for, as the files in it say. */
export type WeightsOf = (family: string) => readonly number[] | null;

/** A font file of the person's own that an app carries in its `assets/fonts/`. */
export interface OwnFont {
  family: string;
  weight: number;
  /** The file's name in the app's `assets/fonts/`: one this server made. */
  file: string;
}

export const OWN_FONT_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.woff2$/;
/** The most font files of a person's own one app carries. */
export const OWN_FONTS_MAX = 8;

/** Own fonts as they may be kept: a plain family name, a weight, a file name of ours; one a family and weight. */
export function cleanOwnFonts(input: unknown): OwnFont[] {
  if (!Array.isArray(input)) return [];
  const out: OwnFont[] = [];
  for (const raw of input) {
    const font = (raw ?? {}) as Record<string, unknown>;
    const { family, weight, file } = font;
    if (typeof family !== 'string' || !isPublicFontName(family) || typeof weight !== 'number' || ![100, 200, 300, 400, 500, 600, 700, 800, 900].includes(weight)) continue;
    if (typeof file !== 'string' || file.length > 80 || !OWN_FONT_FILE.test(file)) continue;
    if (out.some((kept) => kept.family.toLowerCase() === family.toLowerCase() && kept.weight === weight)) continue;
    out.push({ family, weight, file });
  }
  return out.slice(0, OWN_FONTS_MAX);
}

/**
 * A side's `fonts.css`: one import per weight of each family the project
 * carries, and one `@font-face` per font file of the person's own. A family
 * that is neither is left out, and the fallback in `theme.css` stands in: the
 * build never fails for a font.
 */
export function fontsCssOf(theme: Theme, weightsOf: WeightsOf, own: readonly OwnFont[] = []): { css: string; installed: Set<string> } {
  const lines: string[] = [];
  const installed = new Set<string>();
  for (const { family, weights } of themeFamilies(theme)) {
    // The person's own file of this family comes before a package of the same name.
    const files = own.filter((font) => font.family.toLowerCase() === family.toLowerCase());
    if (files.length > 0) {
      installed.add(family);
      for (const font of files) lines.push(`@font-face { font-family: "${family}"; font-weight: ${String(font.weight)}; font-style: normal; font-display: swap; src: url("../../assets/fonts/${font.file}") format("woff2"); }`);
      continue;
    }
    const has = weightsOf(family);
    if (has === null) continue;
    installed.add(family);
    const wanted = weights.filter((weight) => has.includes(weight));
    // A weight the family does not come in: the nearest it has.
    const use = wanted.length > 0 ? wanted : has.length > 0 ? [has.reduce((best, weight) => (Math.abs(weight - (weights[0] ?? 400)) < Math.abs(best - (weights[0] ?? 400)) ? weight : best))] : [];
    for (const weight of use) lines.push(`@import "${fontPackage(family)}/${String(weight)}.css";`);
  }
  return {
    css: `/* The fonts this app's screens carry, served by the app itself. Written by Adminium from the style: change the style, not this file. */\n${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`,
    installed,
  };
}

// ── a picture's colours ─────────────────────────────────────────────────────

/** A colour of a picture and how much of the picture it covers, 0 to 1. */
export interface PaletteColour {
  hex: string;
  share: number;
}

/** A palette as it may be kept: colours as #rrggbb with a share, the most first, sixteen at most. */
export function cleanPalette(input: unknown): PaletteColour[] {
  if (!Array.isArray(input)) return [];
  return input
    .flatMap((entry): PaletteColour[] => {
      const colour = (entry ?? {}) as { hex?: unknown; share?: unknown };
      return typeof colour.hex === 'string' && HEX_COLOUR.test(colour.hex) && typeof colour.share === 'number' && colour.share > 0 && colour.share <= 1 ? [{ hex: colour.hex.toLowerCase(), share: colour.share }] : [];
    })
    .sort((a, b) => b.share - a.share)
    .slice(0, 16);
}

/** How strong a colour is, 0 (a grey) to 1. */
export function saturation(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((value) => value / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function hue(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((value) => value / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueApart = (a: string, b: string): number => {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
};

/**
 * The colours of a theme, read from a picture of a design: the page's
 * background is what covers most of it, its text the darkest colour that is
 * more than a speck, its band the largest strong colour, its accent the strong
 * colour that reads on the background. A reading, not a measurement: null
 * when the picture says too little (a photograph has no "page").
 */
export function themeFromPalette(given: readonly PaletteColour[]): ThemePatch | null {
  const palette = cleanPalette([...given]);
  const page = palette[0];
  // A page covers a good part of its picture; a photograph's commonest colour covers little.
  if (page === undefined || page.share < 0.2) return null;
  const dark = luminance(page.hex) < 0.2;
  const bg = page.hex;
  const others = palette.slice(1);
  const reads = (hex: string, ratio: number): boolean => contrast(hex, bg) >= ratio;
  // Text: the colour furthest from the page in lightness, when it is more than a speck.
  const lettering = others.filter((colour) => colour.share >= 0.004 && reads(colour.hex, 4.5)).sort((a, b) => contrast(b.hex, bg) - contrast(a.hex, bg))[0]?.hex;
  // A strong colour: one with a hue, and light enough to have one (the black of a photograph's shadow is not a brand colour).
  const strong = others.filter((colour) => saturation(colour.hex) >= 0.35 && colour.share >= 0.001 && luminance(colour.hex) >= 0.03);
  // A band: a strong colour that covers a stretch of the page, and is not the page.
  const band = strong.filter((colour) => colour.share >= 0.025 && (hueApart(colour.hex, bg) >= 15 || saturation(colour.hex) - saturation(bg) >= 0.25) && !reads(colour.hex, 7)).sort((a, b) => b.share - a.share)[0]?.hex;
  // The accent: a strong colour that reads on the page; the text's own colour when it is one.
  const accent = strong.filter((colour) => colour.hex !== band && reads(colour.hex, 3)).sort((a, b) => b.share * saturation(b.hex) - a.share * saturation(a.hex))[0]?.hex ?? (lettering !== undefined && saturation(lettering) >= 0.25 ? lettering : undefined);
  if (lettering === undefined && accent === undefined) return null;
  // Lettering is thin, and a small picture of a page may hold too little of it to count: then the text is the accent, darkened, as designed pages often have it.
  const text = lettering ?? (accent === undefined ? undefined : mix(accent, dark ? '#ffffff' : '#000000', 0.55));
  const set: Partial<ThemeColours> = {
    bg,
    surface: dark ? mix(bg, '#ffffff', 0.06) : mix(bg, '#ffffff', 0.6),
    surface2: dark ? mix(bg, '#ffffff', 0.12) : mix(bg, text ?? '#000000', 0.06),
    line: mix(bg, text ?? (dark ? '#ffffff' : '#000000'), 0.14),
    ...(text === undefined ? {} : { text, muted: mix(text, bg, 0.35) }),
    ...(accent === undefined ? {} : { accent }),
    ...(band === undefined ? (accent === undefined ? {} : { accent2: accent }) : { band, accent2: band }),
  };
  return { ...(dark ? { scheme: 'dark' as const } : {}), light: set };
}
