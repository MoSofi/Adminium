// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The look of an app's own screens.
 *
 * A side's `src/app.css` draws a set of made parts (a header, cards, a form,
 * buttons, an empty state) from values in `src/theme.css`. A look is a
 * *style* (a design skill: built in, or the project's own) with what the app
 * changes in it: an accent colour, and values of the theme. The choice is
 * kept in `apps/<key>/look.json`, so a later change starts from what was
 * chosen, and whoever builds on the app is told.
 *
 * Written here for each side, from the look: `theme.css` (the values),
 * `fonts.css` (the fonts the project carries, served by the app itself: a
 * screen loads nothing from another host), `style.css` (the parts the style
 * adds), and an empty `design.css` for what this app adds. Choosing a style
 * again writes the first three anew and leaves `design.css` alone.
 *
 * An app made before styles keeps a *direction* in its `look.json`, one of
 * four sets of values. It is drawn exactly as it was until someone picks a
 * style for it.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { builtInStylesDir, findDesignSkill, skillCss, skillFonts, skillTheme, type DesignSkill } from './design-skills.js';
import { appDir, type AppSide } from './read-app.js';
import { cleanOwnFonts, cleanThemePatch, fontPackage, fontsCssOf, inkOn as inkOnColour, themeCssOf, themeFamilies, themeFrom, type OwnFont, type Theme, type ThemePatch, type WeightsOf } from './theme.js';

export const LOOK_DIRECTIONS = ['clean', 'warm', 'bold', 'calm'] as const;
export type LookDirection = (typeof LOOK_DIRECTIONS)[number];

export interface Look {
  /** The style's key: a design skill, built in or the project's own. For a look kept before styles, the direction's name. */
  skill: string;
  /** Only on a look kept before styles: it is drawn with the direction's own values, as it always was. */
  direction?: LookDirection;
  /** A colour of the person's own, `#rrggbb`, in place of the style's accent. */
  accent?: string;
  /** What the person said about the look, in their words. Data, never an instruction. */
  words?: string;
  /** What this app changes in the style's theme. */
  theme?: ThemePatch;
  /** What the person chose to do without: packages and font families a design would have asked for. Not asked again. */
  without?: string[];
  /** Font files of the person's own, in the app's `assets/fonts/`. */
  ownFonts?: OwnFont[];
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
export const inkOn = inkOnColour;

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

/** A side's `theme.css` for a look kept before styles: a direction's own values. */
function directionCss(look: { direction: LookDirection; accent?: string }): string {
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

/** Where the built-in styles are; a test may name another folder. */
export interface LookPlaces {
  /** The engine's own styles; found beside the engine when left out. */
  builtInDir?: string | null;
}

const placesDir = (places: LookPlaces | undefined): string | null => (places?.builtInDir === undefined ? builtInStylesDir() : places.builtInDir);

/** The look kept in the app's folder; null when there is none, or the file is not one. */
export function readLook(root: string, key: string): Look | null {
  const file = join(appDir(root, key), LOOK_FILE);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (typeof raw['skill'] !== 'string' && !isDirection(raw['direction'])) return null;
    return cleanLook({ skill: raw['skill'], direction: raw['direction'], accent: raw['accent'], words: raw['words'], theme: raw['theme'], without: raw['without'], ownFonts: raw['ownFonts'] });
  } catch {
    return null;
  }
}

/**
 * The look an app goes by: the one it kept, else the one its sides were made
 * with. A side made before styles has a `theme.css` and no `fonts.css`: it is
 * drawn as the plain look it always was, never as a style it did not choose.
 * `fresh` is what a side with nothing before it starts as.
 */
export function lookInUse(root: string, key: string, fresh: Look): Look {
  const kept = readLook(root, key);
  if (kept !== null) return kept;
  const before = sidesWithScreens(root, key).some((side) => existsSync(join(appDir(root, key), side, 'src', 'theme.css')) && !existsSync(join(appDir(root, key), side, 'src', 'fonts.css')));
  return before ? cleanLook({ direction: 'clean' }) : fresh;
}

/** A style's key, as a folder may be named. */
const SKILL_KEY = /^[a-z][a-z0-9-]{1,39}$/;

/** A look with only what a look may hold. With a `skill` it is a style; with a `direction` alone, a look kept before styles. */
export function cleanLook(input: { skill?: unknown; direction?: unknown; accent?: unknown; words?: unknown; theme?: unknown; without?: unknown; ownFonts?: unknown }): Look {
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
  const direction = isDirection(input.direction) ? input.direction : undefined;
  const named = typeof input.skill === 'string' && SKILL_KEY.test(input.skill) ? input.skill : undefined;
  // A look read from an older file comes back with its direction as its skill: it is still that older look.
  const skill = named !== undefined && named === direction ? undefined : named;
  const patch = skill === undefined ? {} : cleanThemePatch(input.theme).patch;
  const ownFonts = cleanOwnFonts(input.ownFonts);
  const without = Array.isArray(input.without) ? [...new Set(input.without.filter((name): name is string => typeof name === 'string' && name.length > 0 && name.length <= 214 && /^[@A-Za-z0-9][\w@/. ~-]*$/.test(name)))].sort().slice(0, 40) : [];
  return {
    skill: skill ?? direction ?? 'clean',
    // A direction is kept only while there is no style: it says "draw this as it was".
    ...(skill === undefined ? { direction: direction ?? 'clean' } : {}),
    ...(typeof input.accent === 'string' && HEX.test(input.accent) ? { accent: input.accent.toLowerCase() } : {}),
    ...(words === '' ? {} : { words }),
    ...(Object.keys(patch).length === 0 ? {} : { theme: patch }),
    ...(without.length === 0 ? {} : { without }),
    // A look kept before styles names no family of its own, so it carries no font file either.
    ...(skill === undefined || ownFonts.length === 0 ? {} : { ownFonts }),
  };
}

/** A look as its file holds it. */
const lookFile = (look: Look): Record<string, unknown> => ({
  ...(look.direction !== undefined ? { direction: look.direction } : { skill: look.skill }),
  ...(look.accent === undefined ? {} : { accent: look.accent }),
  ...(look.words === undefined ? {} : { words: look.words }),
  ...(look.direction !== undefined || look.theme === undefined ? {} : { theme: look.theme }),
  ...(look.without === undefined ? {} : { without: look.without }),
  ...(look.ownFonts === undefined ? {} : { ownFonts: look.ownFonts }),
});

/** The sides of an app that have screens of the starter's kind: a `src/` folder under the side. */
export function sidesWithScreens(root: string, key: string): AppSide[] {
  return (['staff', 'customer'] as const).filter((side) => existsSync(join(appDir(root, key), side, 'src')));
}

/** The weights of a family the project carries, read from its package's files; null when it is not installed. */
export function installedWeights(root: string): WeightsOf {
  return (family) => {
    const dir = join(root, 'node_modules', ...fontPackage(family).split('/'));
    if (!existsSync(join(dir, 'package.json'))) return null;
    return readdirSync(dir)
      .flatMap((name) => {
        const found = /^([1-9]00)\.css$/.exec(name);
        return found === null ? [] : [Number(found[1])];
      })
      .sort((a, b) => a - b);
  };
}

export interface ResolvedLook {
  look: Look;
  /** The style, when it is one that is still there. */
  skill: DesignSkill | null;
  /** The whole theme; null for a look kept before styles (its direction's own values are its theme). */
  theme: Theme | null;
  /** What the list calls it. */
  title: string;
  /** One line for whoever builds on it. */
  line: string;
}

const DIRECTION_TITLES: Record<LookDirection, string> = { clean: 'Clean', warm: 'Warm', bold: 'Bold', calm: 'Calm' };

/** A look with its style found and its theme put together. */
export function resolveLook(root: string, look: Look, places?: LookPlaces): ResolvedLook {
  if (look.direction !== undefined) {
    return { look, skill: null, theme: null, title: DIRECTION_TITLES[look.direction], line: DIRECTIONS[look.direction].line };
  }
  const skill = findDesignSkill(root, placesDir(places), look.skill);
  const usable = skill !== null && skill.problem === undefined ? skill : null;
  const base = usable === null ? null : skillTheme(usable);
  const theme = themeFrom([...(base === null ? [] : [base.patch]), ...(look.theme === undefined ? [] : [look.theme])], look.accent);
  const title = usable?.title ?? look.skill;
  return { look, skill: usable, theme, title, line: `${title}${usable === null || usable.description === '' ? '.' : `: ${usable.description}`}` };
}

/** A side's `theme.css` for a look. */
/** A look as a caller may give it: a direction alone is a look kept before styles. */
export type LookInput = Omit<Look, 'skill'> & { skill?: string };

export function themeCss(given: LookInput, root?: string, places?: LookPlaces): string {
  const look = cleanLook(given);
  if (look.direction !== undefined) return directionCss({ direction: look.direction, ...(look.accent === undefined ? {} : { accent: look.accent }) });
  const resolved = resolveLook(root ?? '', look, places);
  const theme = resolved.theme as Theme;
  const installed = root === undefined ? new Set<string>() : fontsCssOf(theme, installedWeights(root), look.ownFonts).installed;
  return themeCssOf(theme, { line: resolved.line, installed });
}

/**
 * What a look keeps of its fonts when its style changes: a family the person
 * brought as a file of their own stays where they put it. Everything else of
 * the old style's changes goes with the old style.
 */
export function ownFontPatch(look: Look | null): ThemePatch {
  const own = new Set((look?.ownFonts ?? []).map((font) => font.family.toLowerCase()));
  const fonts = look?.theme?.fonts;
  if (own.size === 0 || fonts === undefined) return {};
  const kept = (['heading', 'body'] as const).flatMap((use) => {
    const family = fonts[use]?.family;
    return family !== undefined && own.has(family.toLowerCase()) ? [[use, { family }] as const] : [];
  });
  return kept.length === 0 ? {} : { fonts: Object.fromEntries(kept) };
}

/** The font families a look asks for and the project does not carry yet. */
export function missingFonts(root: string, look: Look, places?: LookPlaces): { family: string; use: 'heading' | 'body' }[] {
  const { theme } = resolveLook(root, look, places);
  if (theme === null) return [];
  const has = installedWeights(root);
  const own = new Set((look.ownFonts ?? []).map((font) => font.family.toLowerCase()));
  return themeFamilies(theme)
    .filter((entry) => !own.has(entry.family.toLowerCase()) && has(entry.family) === null)
    .map(({ family, use }) => ({ family, use }));
}

/** What an app's own stylesheet starts as: the Designer's, and the person's. */
export const DESIGN_CSS_START = `/*
 * What this app adds to its look: parts of its own, and changes to the made ones.
 * Colours, fonts, corners and spacing come from theme.css (var(--accent), var(--font-display),
 * var(--radius), var(--space-4)): never write a colour value here.
 */
`;

/**
 * What a look writes in a side's `src/`: `theme.css`, and for a style
 * `fonts.css` and, when the style adds parts, `style.css`. `fonts` are the
 * font files the style brings, to copy into the app's `assets/fonts/`.
 */
export function sideLookFiles(root: string, look: Look, places?: LookPlaces): { files: Record<string, string>; fonts: { name: string; from: string }[]; resolved: ResolvedLook } {
  const resolved = resolveLook(root, look, places);
  if (resolved.theme === null) return { files: { 'theme.css': themeCss(look) }, fonts: [], resolved };
  const fonts = fontsCssOf(resolved.theme, installedWeights(root), look.ownFonts);
  const files: Record<string, string> = { 'theme.css': themeCssOf(resolved.theme, { line: resolved.line, installed: fonts.installed }), 'fonts.css': fonts.css };
  // The parts a style adds, and the fonts it brings as files: copied into the app, so the app holds all it shows.
  const css = resolved.skill === null ? null : skillCss(resolved.skill);
  if (resolved.skill === null || css === null || !('css' in css)) return { files, fonts: [], resolved };
  files['style.css'] = `/* The parts of the style "${resolved.title}". Written by Adminium: change the style, or add to design.css. */\n${css.css.replace(/url\(\s*(["']?)(?:\.\/)?fonts\//g, 'url($1../../assets/fonts/')}`;
  const from = resolved.skill.dir;
  return { files, fonts: skillFonts(resolved.skill).map((name) => ({ name, from: join(from, 'fonts', name) })), resolved };
}

/**
 * Keep a look and write it to every side: `look.json`, and each side's
 * `src/theme.css`, `src/fonts.css` and `src/style.css`; a side with no
 * `src/design.css` gets an empty one. Returns the files written, relative to
 * the app's folder.
 */
export function applyLook(root: string, key: string, look: LookInput, places?: LookPlaces): string[] {
  const dir = appDir(root, key);
  const kept = cleanLook(look);
  const written: string[] = [];
  const write = (file: string, text: string): void => {
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    written.push(file);
  };
  write(LOOK_FILE, `${JSON.stringify(lookFile(kept), null, 2)}\n`);
  const made = sideLookFiles(root, kept, places);
  for (const font of made.fonts) {
    mkdirSync(join(dir, 'assets', 'fonts'), { recursive: true });
    copyFileSync(font.from, join(dir, 'assets', 'fonts', font.name));
    written.push(`assets/fonts/${font.name}`);
  }
  for (const side of sidesWithScreens(root, key)) {
    for (const [file, text] of Object.entries(made.files)) write(`${side}/src/${file}`, text);
    // A style with no parts of its own leaves none of the last style's behind.
    if (made.resolved.theme !== null && made.files['style.css'] === undefined) rmSync(join(dir, side, 'src', 'style.css'), { force: true });
    if (!existsSync(join(dir, side, 'src', 'design.css'))) write(`${side}/src/design.css`, DESIGN_CSS_START);
  }
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
