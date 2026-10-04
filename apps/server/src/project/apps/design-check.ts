// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's own screens lack as a design, read from its files.
 *
 * The manifest check says whether an app installs. This says whether its
 * screens look made: a class a screen uses that nothing styles (the page then
 * shows plain text where a designed part was meant), an emoji standing in for
 * an icon, colours and fonts written as values where the theme's should be,
 * a public side with no logo, no brief.
 *
 * Each finding is one line that names the file and the fix, in the same words
 * each time it is found, so it can be said and then not said again. It is a
 * reading, not a proof: where the files do not say for certain, nothing is
 * said. A finding that cannot be acted on is worse than none.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readLook, resolveLook, type LookPlaces } from './look.js';
import { hasOwnBuild } from './own-build.js';
import { appDir, appPath, SIDES, type AppSide } from './read-app.js';
import { code } from './side-calls.js';
import { projectTailwind, tailwindCss } from './side-build.js';

export interface DesignIssue {
  /** What kind of finding it is: a test and the page tell them apart by this. */
  kind: 'class' | 'emoji' | 'colour' | 'font' | 'logo' | 'brief' | 'inline' | 'pictures';
  /** One line for the model, the same each time. */
  line: string;
}

export interface DesignCheckOptions extends LookPlaces {
  /** The app was made in this session and has no version yet: only then is a brief asked for. */
  fresh?: boolean;
  /** Whether the project carries an icon package: the fix for an emoji is worded by it. */
  icons?: boolean;
  /** Picture columns of tables customers read whose sample rows have no picture: asked only where pictures can be looked for. */
  emptyPictureColumns?: { table: string; column: string }[];
}

const MAX_FILES = 60;
const MAX_BYTES = 256 * 1024;

function sources(dir: string, keep: RegExp): { name: string; path: string; text: string }[] {
  const out: { name: string; path: string; text: string }[] = [];
  const walk = (folder: string, rel: string): void => {
    if (!existsSync(folder)) return;
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES || entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path, rel === '' ? entry.name : `${rel}/${entry.name}`);
      else if (entry.isFile() && keep.test(entry.name) && statSync(path).size <= MAX_BYTES) out.push({ name: rel === '' ? entry.name : `${rel}/${entry.name}`, path, text: readFileSync(path, 'utf8') });
    }
  };
  walk(dir, '');
  return out;
}

/** The text between a `{` at `from` and its matching `}`; null when it does not close. */
function braced(text: string, from: number): string | null {
  let depth = 0;
  for (let at = from; at < text.length && at < from + 4000; at += 1) {
    const mark = text[at];
    if (mark === '{') depth += 1;
    else if (mark === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(from + 1, at);
    }
  }
  return null;
}

/**
 * The class names a screen's source writes out in full. A name built in
 * pieces (`btn-${size}`), or held in a variable, is not one this can read,
 * and is passed over: the piece next to a `${` is never a whole name.
 */
export function classesIn(source: string): string[] {
  const text = code(source);
  const found = new Set<string>();
  const take = (words: string): void => {
    for (const word of words.split(/\s+/)) if (word !== '') found.add(word);
  };
  for (const plain of text.matchAll(/\bclass(?:Name)?\s*=\s*"([^"]*)"/g)) take(plain[1] as string);
  for (const start of text.matchAll(/\bclass(?:Name)?\s*=\s*\{/g)) {
    const inside = braced(text, start.index + start[0].length - 1);
    if (inside === null) continue;
    for (const quoted of inside.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) take((quoted[1] ?? quoted[2]) as string);
    for (const template of inside.matchAll(/`([^`]*)`/g)) {
      // The static stretches of a template; the word touching a `${…}` is a piece of a name, not a name.
      const parts = (template[1] as string).split(/\$\{[^}]*\}/);
      parts.forEach((part, index) => {
        let words = part;
        if (index > 0) words = words.replace(/^\S+/, '');
        if (index < parts.length - 1) words = words.replace(/\S+$/, '');
        take(words);
      });
    }
  }
  return [...found];
}

/** The class names a stylesheet gives a rule to, with Tailwind's escapes taken off (`md\:p-4` → `md:p-4`). */
export function classesDefined(css: string): Set<string> {
  const out = new Set<string>();
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const found of bare.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) {
    const name = (found[1] as string).replace(/\\(.)/g, '$1');
    if (/^[A-Za-z_-]/.test(name) || /^\d/.test(name)) out.add(name);
  }
  return out;
}

/** Marks that are pictographs to Unicode and plain typography to a reader: never called an emoji. */
const NOT_EMOJI = new Set(['©', '®', '™', '♥', '☎', '✓', '✔', '✕', '✗', '✘', '★', '☆', '♪', '↗', '↘', '↔', '↩', '↪', '▶', '◀', '☰', '✉', '✎', '❯', '❮', '‼', '⁉', 'ℹ', '〰', '㊗', '㊙', '▪', '▫', '◼', '◻', '◾', '◽', '☑', '✖', '➕', '➖', '➗', '➡', '⬅', '⬆', '⬇', '♀', '♂', '⚠']);

/** The first emoji in a screen's source, outside its comments; null when it has none. */
export function emojiIn(source: string): string | null {
  for (const found of code(source).matchAll(/\p{Extended_Pictographic}/gu)) {
    const mark = found[0];
    if (!NOT_EMOJI.has(mark) && (mark.codePointAt(0) ?? 0) > 0xff) return mark;
  }
  return null;
}

const PLAIN_HEX = new Set(['#fff', '#ffffff', '#000', '#000000']);

/** The colours a file writes as values: hex only, and not plain black or white. */
export function rawColours(text: string): string[] {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...new Set([...bare.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)].map((found) => found[0].toLowerCase()))].filter((colour) => !PLAIN_HEX.has(colour));
}

/** How many colour values a stylesheet of the app's own may hold before it is said: a shadow or a gradient needs one or two. */
const COLOURS_ALLOWED = 3;

/**
 * What the screens of `apps/<key>/` lack as a design. Nothing for an app
 * with a build of its own (its authors' design), or with no starter side.
 */
export async function designIssues(root: string, key: string, opts: DesignCheckOptions = {}): Promise<DesignIssue[]> {
  if (hasOwnBuild(root, key)) return [];
  const dir = appDir(root, key);
  const sides = SIDES.filter((side) => existsSync(join(dir, side, 'src', 'theme.css')) && existsSync(join(dir, side, 'src', 'main.tsx')));
  if (sides.length === 0) return [];
  const issues: DesignIssue[] = [];
  const tailwind = projectTailwind(root);
  const look = readLook(root, key);
  const theme = look === null ? null : resolveLook(root, look, opts).theme;

  for (const side of sides) {
    const src = join(dir, side, 'src');
    const at = (name: string): string => appPath(key, side, 'src', name);
    const screens = sources(src, /\.(?:tsx|jsx)$/);
    const sheets = sources(src, /\.css$/);

    // A class a screen uses that nothing styles.
    const defined = new Set<string>();
    for (const sheet of sheets) for (const name of classesDefined(sheet.text)) defined.add(name);
    const used = new Map<string, string>();
    for (const screen of screens) for (const name of classesIn(screen.text)) if (!defined.has(name) && !used.has(name)) used.set(name, screen.name);
    let unknown = [...used.keys()];
    if (unknown.length > 0 && tailwind !== null && !('problem' in tailwind)) {
      try {
        const known = classesDefined(await tailwindCss(tailwind, src, unknown));
        unknown = unknown.filter((name) => !known.has(name));
      } catch {
        // Tailwind could not be asked: nothing is said of a class it might know.
        unknown = [];
      }
    }
    for (const name of unknown.sort().slice(0, 12)) {
      issues.push({
        kind: 'class',
        line: `- The class "${name}" (${at(used.get(name) as string)}) is styled nowhere, so that part shows unstyled: write .${name.replace(/[^\w-]/g, '\\$&')} { … } in ${at('design.css')}, or use a made part of app.css${tailwind === null ? '' : ' or a Tailwind class'} in its place.`,
      });
    }

    // An emoji where an icon belongs.
    for (const screen of screens) {
      const emoji = emojiIn(screen.text);
      if (emoji === null) continue;
      issues.push({
        kind: 'emoji',
        line: `- ${at(screen.name)} uses an emoji (${emoji}) as an icon: ${opts.icons === true ? 'import an icon from "lucide-react" in its place' : 'draw a small inline SVG in its place'}. An emoji looks different on every device and reads as unfinished.`,
      });
    }

    // Colours and fonts written as values, where the theme's belong.
    for (const sheet of sheets.filter((entry) => entry.name === 'design.css')) {
      const colours = rawColours(sheet.text);
      if (colours.length > COLOURS_ALLOWED) {
        issues.push({
          kind: 'colour',
          line: `- ${at(sheet.name)} writes colours as values (${colours.slice(0, 3).join(', ')}, …): use the theme's (var(--accent), var(--surface), var(--band)), and to change a colour call set_style with a "theme". Then the style menu and dark mode keep working.`,
        });
      }
      if (theme !== null) {
        const carried = new Set([theme.fonts.heading.family, theme.fonts.body.family].filter((family): family is string => family !== undefined).map((family) => family.toLowerCase()));
        const named = [...sheet.text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/font-family\s*:\s*["']([^"']+)["']/g)].map((found) => found[1] as string).find((family) => !carried.has(family.toLowerCase()));
        if (named !== undefined) {
          issues.push({
            kind: 'font',
            line: `- ${at(sheet.name)} names the font "${named.slice(0, 40)}", which this app does not carry, so the system's font shows in its place: use var(--font-display) or var(--font-body), or change the style's font with set_style (the person is asked for it).`,
          });
        }
      }
    }
    for (const screen of screens) {
      // A custom property passed down is not styling: `style={{ '--w': x }}` is left alone.
      const inline = [...code(screen.text).matchAll(/\bstyle\s*=\s*\{\{([^}]*)\}\}/g)].find((found) => /(^|,)\s*[a-zA-Z]+\s*:/.test(found[1] as string));
      if (inline !== undefined) {
        issues.push({ kind: 'inline', line: `- ${at(screen.name)} styles an element inline (style={{ … }}): give it a class and write the rule in ${at('design.css')}.` });
      }
    }
  }

  // A public side has a logo, and shows it.
  if (sides.includes('customer' as AppSide)) {
    const logo = join(dir, 'assets', 'logo.svg');
    const shown = sources(join(dir, 'customer', 'src'), /\.(?:tsx|jsx)$/).some((screen) => /logo\.svg['"]|<Logo\b|function Logo\b|const Logo\b/.test(code(screen.text)));
    if (!existsSync(logo) && !shown) {
      issues.push({
        kind: 'logo',
        line: `- The public page has no logo: write ${appPath(key, 'assets', 'logo.svg')} (a simple mark for this business with its colour written in the file, since a picture shown with <img> cannot read the page's values; no script, no address of another site) and show it in the header beside the name: import logo from '../../assets/logo.svg', then <img className="logo" src={logo} alt="" />.`,
      });
    } else if (existsSync(logo) && !shown) {
      issues.push({ kind: 'logo', line: `- ${appPath(key, 'assets', 'logo.svg')} is written and no screen shows it: import it in the customer screen and put it in the header beside the name.` });
    } else if (existsSync(logo) && /var\(--|currentColor/.test(readFileSync(logo, 'utf8'))) {
      // A picture shown with <img> is drawn on its own: the page's values do not reach inside it, and the shape comes out with no colour.
      issues.push({
        kind: 'logo',
        line: `- ${appPath(key, 'assets', 'logo.svg')} takes its colour from the page (var(--…) or currentColor), which a picture shown with <img> cannot see, so the logo comes out blank: write the colour's value in the file itself (${theme === null ? 'the accent\'s #rrggbb' : `the accent is ${theme.light.accent}`}).`,
      });
    } else if (existsSync(logo) && /<script|\son[a-z]+\s*=|<foreignObject|href\s*=\s*["']https?:/i.test(readFileSync(logo, 'utf8'))) {
      issues.push({ kind: 'logo', line: `- ${appPath(key, 'assets', 'logo.svg')} has a script or an address of another site in it: a logo is shapes and nothing else. Write it again.` });
    }
  }

  // What customers look at before they choose has pictures: a picture column whose sample rows are all empty is a page of grey tiles.
  if (opts.fresh === true && opts.emptyPictureColumns !== undefined) {
    for (const { table, column } of opts.emptyPictureColumns) {
      issues.push({
        kind: 'pictures',
        line: `- No sample row of "${table}" has a picture in "${column}", so the page shows empty tiles: call find_pictures with { "id": "${table.replace(/_/g, '-')}", "words": what these rows show, "for": "rows", "table": "${table}", "column": "${column}" }.`,
      });
    }
  }

  // The brief, for an app this session is making.
  if (opts.fresh === true) {
    const brief = join(dir, 'design.md');
    if (!existsSync(brief) || readFileSync(brief, 'utf8').trim().length < 80) {
      issues.push({
        kind: 'brief',
        line: `- There is no design brief: write ${appPath(key, 'design.md')} (who the page is for, the feeling in three words, the style and what you change in it, the sections of the first page in order, what the pictures show, the logo's idea). Later turns are given it, so the page stays one design.`,
      });
    }
  }
  return issues;
}
