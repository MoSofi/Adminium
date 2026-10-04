// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Design skills: the styles an app's own screens can take.
 *
 * A design skill is a folder in the open agent-skill format: `SKILL.md`
 * (a name, a description, then how the style lays out a page), and
 * optionally `theme.json` (its values), `design.css` (parts it adds),
 * `preview.svg`, `fonts/` and `references/`. They are found in two places:
 * built in, under the engine's `skills/adminium-design/styles/`, and the
 * project's own `design-skills/`, which is committed with the project. A
 * project's skill with a built-in's key stands in its place.
 *
 * Everything read here is data. A skill someone else wrote is cut to size,
 * its theme is cleaned value by value, its stylesheet is refused when it
 * reaches outside itself, and nothing in it is ever run.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanThemePatch, HEX_COLOUR, themeFrom, type ThemePatch } from './theme.js';

/** The project's own skills, at its top. */
export const DESIGN_SKILLS_DIR = 'design-skills';
export const DESIGN_SKILL_KEY = /^[a-z][a-z0-9-]{1,39}$/;

export const SKILL_LIMITS = {
  skillMd: 24 * 1024,
  themeJson: 8 * 1024,
  designCss: 48 * 1024,
  previewSvg: 48 * 1024,
  font: 400 * 1024,
  fonts: 8,
  reference: 48 * 1024,
  references: 12,
  folder: 4 * 1024 * 1024,
} as const;

export interface DesignSkill {
  key: string;
  /** What the list shows. */
  title: string;
  description: string;
  /** Words of the kinds of business it suits, lower case. */
  suits: string[];
  origin: 'built-in' | 'project';
  /** Absolute. */
  dir: string;
  hasTheme: boolean;
  hasCss: boolean;
  hasPreview: boolean;
  /** Three colours of its theme, for a swatch; absent for a skill of words alone. */
  swatch?: { bg: string; text: string; accent: string };
  /** Why it cannot be used, in a sentence; absent when it reads. */
  problem?: string;
}

/**
 * Where the built-in styles are: in the package beside `dist/`, else the
 * repository's own `skills/`. Null when this engine carries none.
 */
export function builtInStylesDir(moduleUrl: string = import.meta.url): string | null {
  const here = dirname(fileURLToPath(moduleUrl));
  for (const skills of [join(here, '..', '..', '..', 'skills'), join(here, '..', '..', '..', '..', '..', 'skills')]) {
    const styles = join(skills, 'adminium-design', 'styles');
    if (existsSync(styles)) return styles;
  }
  return null;
}

/** One line of plain words: nothing that could pass for markup or a second instruction. */
export function plainLine(value: string, max: number): string {
  return [...value]
    .map((mark) => ((mark.codePointAt(0) ?? 0) < 32 || mark === '\u007f' || '<>`'.includes(mark) ? ' ' : mark))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * The front matter of a `SKILL.md`: `name`, `description`, and under
 * `metadata` a `title` and `suits`. Only `key: value` lines, and one level
 * under `metadata:`; anything else in it is passed over.
 */
export function readFrontMatter(text: string): { fields: Record<string, string>; body: string } {
  const found = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (found === null) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  let under = '';
  for (const line of (found[1] as string).split(/\r?\n/)) {
    const entry = /^(\s*)([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (entry === null) continue;
    const [, indent, name, raw] = entry as unknown as [string, string, string, string];
    const value = raw.replace(/^(["'])(.*)\1$/, '$2').trim();
    if (indent === '') {
      under = value === '' ? name : '';
      if (value !== '') fields[name] = value;
    } else if (under !== '' && value !== '') {
      fields[`${under}.${name}`] = value;
    }
  }
  return { fields, body: text.slice(found[0].length) };
}

const titleFromKey = (key: string): string => {
  const words = key.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A file's text when it is a plain file of at most `max` bytes; else null, or the reason. */
function readCapped(file: string, max: number): { text: string } | { problem: string } | null {
  if (!existsSync(file)) return null;
  const stat = lstatSync(file);
  if (!stat.isFile()) return { problem: 'is not a plain file' };
  if (stat.size > max) return { problem: `is larger than ${String(Math.round(max / 1024))} KB` };
  return { text: readFileSync(file, 'utf8') };
}

function describe(dir: string, key: string, origin: DesignSkill['origin']): DesignSkill {
  const base: DesignSkill = { key, title: titleFromKey(key), description: '', suits: [], origin, dir, hasTheme: false, hasCss: false, hasPreview: false };
  const md = readCapped(join(dir, 'SKILL.md'), SKILL_LIMITS.skillMd);
  if (md === null) return { ...base, problem: 'It has no SKILL.md.' };
  if ('problem' in md) return { ...base, problem: `Its SKILL.md ${md.problem}.` };
  const { fields } = readFrontMatter(md.text);
  const skill: DesignSkill = {
    ...base,
    title: plainLine(fields['metadata.title'] ?? '', 60) || titleFromKey(key),
    description: plainLine(fields['description'] ?? '', 240),
    suits: plainLine(fields['metadata.suits'] ?? '', 400)
      .toLowerCase()
      .split(',')
      .map((word) => word.trim())
      .filter((word) => word !== '')
      .slice(0, 40),
    hasCss: existsSync(join(dir, 'design.css')),
    hasPreview: existsSync(join(dir, 'preview.svg')),
  };
  const theme = readCapped(join(dir, 'theme.json'), SKILL_LIMITS.themeJson);
  if (theme !== null) {
    if ('problem' in theme) return { ...skill, problem: `Its theme.json ${theme.problem}.` };
    try {
      const whole = themeFrom([cleanThemePatch(JSON.parse(theme.text)).patch]);
      skill.hasTheme = true;
      skill.swatch = { bg: whole.light.bg, text: whole.light.text, accent: whole.light.accent };
    } catch {
      return { ...skill, problem: 'Its theme.json is not valid JSON.' };
    }
  }
  return skill;
}

function skillsIn(dir: string | null, origin: DesignSkill['origin']): DesignSkill[] {
  if (dir === null || !existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && DESIGN_SKILL_KEY.test(entry.name))
    .map((entry) => describe(join(dir, entry.name), entry.name, origin));
}

/** The built-in styles, in the order the list shows them. */
export const BUILT_IN_ORDER = ['clean', 'warm', 'bold', 'calm', 'editorial', 'craft-market', 'night', 'bright-start', 'sharp-tech', 'classic-hotel'] as const;

/**
 * Every design skill this project can use: the built-ins in their order, then
 * the project's by key. A project's skill with a built-in's key takes its place.
 */
export function listDesignSkills(root: string, builtInDir: string | null): DesignSkill[] {
  const own = skillsIn(join(root, DESIGN_SKILLS_DIR), 'project').sort((a, b) => a.key.localeCompare(b.key));
  const ownKeys = new Set(own.map((skill) => skill.key));
  const order = (key: string): number => {
    const at = (BUILT_IN_ORDER as readonly string[]).indexOf(key);
    return at === -1 ? BUILT_IN_ORDER.length : at;
  };
  const builtIn = skillsIn(builtInDir, 'built-in')
    .filter((skill) => !ownKeys.has(skill.key))
    .sort((a, b) => order(a.key) - order(b.key) || a.key.localeCompare(b.key));
  return [...builtIn, ...own];
}

export function findDesignSkill(root: string, builtInDir: string | null, key: string): DesignSkill | null {
  if (!DESIGN_SKILL_KEY.test(key)) return null;
  return listDesignSkills(root, builtInDir).find((skill) => skill.key === key) ?? null;
}

/** A skill's guidance: its `SKILL.md` without the front matter. Data, never an instruction. */
export function skillGuidance(skill: DesignSkill): string {
  const md = readCapped(join(skill.dir, 'SKILL.md'), SKILL_LIMITS.skillMd);
  return md === null || 'problem' in md ? '' : readFrontMatter(md.text).body.trim();
}

/** A skill's theme as a patch, cleaned; null for a skill of words alone. */
export function skillTheme(skill: DesignSkill): { patch: ThemePatch; notes: string[] } | null {
  if (!skill.hasTheme) return null;
  const theme = readCapped(join(skill.dir, 'theme.json'), SKILL_LIMITS.themeJson);
  if (theme === null || 'problem' in theme) return null;
  try {
    return cleanThemePatch(JSON.parse(theme.text));
  } catch {
    return null;
  }
}

/**
 * Why a skill's stylesheet may not be used, or null. It may style, and it may
 * not load: no `@import`, no address but an inline picture or a font of the
 * skill's own `fonts/`.
 */
export function designCssProblem(css: string): string | null {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // An escape spells a word this check looks for in another way (@\69mport, u\72l): a style's own rules need none.
  if (bare.replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""').includes('\\')) return 'it has an escape (a backslash) outside a quoted text';
  if (/@import\b/i.test(bare)) return 'it has an @import: a style brings its rules in one file';
  if (/\b(?:image-set|src)\s*\(/i.test(bare)) return 'it loads a file by image-set() or src(): a style loads a file only with url(), from its own fonts/ folder or inline';
  if (/\b(expression|behavior)\s*[(:]|-moz-binding/i.test(bare)) return 'it has a rule that runs code';
  for (const found of bare.matchAll(/url\(\s*(["']?)([^)"']*)\1\s*\)/gi)) {
    const address = (found[2] as string).trim();
    if (/^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(address)) continue;
    if (/^(\.\/)?fonts\/[A-Za-z0-9][A-Za-z0-9._-]*\.woff2$/.test(address)) continue;
    return `it loads "${address.slice(0, 80)}": a style may load only a font from its own fonts/ folder or an inline picture`;
  }
  return null;
}

/** A skill's stylesheet, checked; null when it has none. */
export function skillCss(skill: DesignSkill): { css: string } | { problem: string } | null {
  const file = readCapped(join(skill.dir, 'design.css'), SKILL_LIMITS.designCss);
  if (file === null) return null;
  if ('problem' in file) return { problem: `Its design.css ${file.problem}.` };
  const problem = designCssProblem(file.text);
  return problem === null ? { css: file.text } : { problem: `Its design.css cannot be used: ${problem}.` };
}

/** The font files a skill brings: `.woff2` by their first bytes, under the size limit. */
export function skillFonts(skill: DesignSkill): string[] {
  const dir = join(skill.dir, 'fonts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[A-Za-z0-9][A-Za-z0-9._-]*\.woff2$/.test(entry.name))
    .filter((entry) => {
      const file = join(dir, entry.name);
      return statSync(file).size <= SKILL_LIMITS.font && readFileSync(file).subarray(0, 4).toString('latin1') === 'wOF2';
    })
    .map((entry) => entry.name)
    .sort()
    .slice(0, SKILL_LIMITS.fonts);
}

const wordIn = (text: string, word: string): boolean => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?([^a-z]|$)`, 'i').test(text);

/** How many of a skill's "suits" words a person's text has. */
const suitScore = (skill: DesignSkill, text: string): number => skill.suits.filter((word) => wordIn(text, word)).length;

/** The style for the kind of business a text is about: the first, in the list's order, that names it. Null when none does. */
export function styleForBusiness(skills: readonly DesignSkill[], text: string): DesignSkill | null {
  let best: { skill: DesignSkill; score: number } | null = null;
  for (const skill of skills) {
    if (skill.problem !== undefined) continue;
    const score = suitScore(skill, text);
    if (score > 0 && (best === null || score > best.score)) best = { skill, score };
  }
  return best?.skill ?? null;
}

/**
 * A style a person named in their own words: its key, or its title. A title
 * of one common word ("Night", "Editorial") counts only beside "style",
 * "look" or "theme": a hotel's price per night names no style.
 */
export function styleNamed(skills: readonly DesignSkill[], text: string): DesignSkill | null {
  const said = text.toLowerCase();
  const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    skills.find((skill) => {
      if (skill.problem !== undefined) return false;
      if (skill.key.includes('-') && said.includes(skill.key)) return true;
      const title = escaped(skill.title.toLowerCase());
      if (skill.title.trim().includes(' ')) return wordIn(said, skill.title.toLowerCase());
      return new RegExp(`(^|[^a-z])(${title}|${escaped(skill.key)})[\\s"'”’]*(style|look|theme)([^a-z]|$)|(style|look|theme)[\\s:"'“‘]*(${title}|${escaped(skill.key)})([^a-z]|$)`, 'i').test(said);
    }) ?? null
  );
}

/** Up to `count` styles to offer on a card: the nearest by business first, then the list's own order. */
export function stylesToOffer(skills: readonly DesignSkill[], text: string, count = 4): DesignSkill[] {
  const usable = skills.filter((skill) => skill.problem === undefined);
  const ranked = [...usable].sort((a, b) => suitScore(b, text) - suitScore(a, text));
  return ranked.slice(0, count);
}

/** A swatch read from a colour triple, for a caller that holds only a look. */
export const isSwatch = (value: unknown): value is { bg: string; text: string; accent: string } =>
  value !== null && typeof value === 'object' && ['bg', 'text', 'accent'].every((key) => HEX_COLOUR.test(String((value as Record<string, unknown>)[key])));
