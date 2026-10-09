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

import { mentionsLook, readLook, resolveLook, type LookPlaces } from './look.js';
import { hasOwnBuild } from './own-build.js';
import { appDir, appPath, SIDES, type AppSide } from './read-app.js';
import { code } from './side-calls.js';
import { projectTailwind, tailwindCss } from './side-build.js';
import { contrast, inkOn, type Theme, type ThemeColours } from './theme.js';

export interface DesignIssue {
  /** What kind of finding it is: a test and the page tell them apart by this. */
  kind: 'class' | 'emoji' | 'colour' | 'font' | 'logo' | 'brief' | 'inline' | 'pictures' | 'contrast' | 'dashboard' | 'component' | 'address';
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

/**
 * The components a screen draws (`<Label …>`) that it neither imports nor
 * declares: the build passes, and the page is blank with "Label is not
 * defined". Only a tag where a tag can stand: a type's own `<T>` after a name
 * (`useState<Item>`) is not one.
 */
export function unbroughtComponents(source: string): string[] {
  // Quoted text is not code: 'Press <Enter> to send' draws nothing.
  const text = code(source).replace(/'[^'\n]*'|"[^"\n]*"/g, (quoted) => quoted[0] + ' '.repeat(quoted.length - 2) + quoted[0]);
  const drawn = new Set<string>();
  for (const found of text.matchAll(/(^|[^\w$.)\]`])<([A-Z][\w$]*)(?=[\s/>.])/gm)) drawn.add(found[2] as string);
  // A name that stands anywhere but in a tag was brought or made somewhere: imported, declared, an argument, taken out
  // of a list or an object, a type's own letter. Only a name that is never anything but a tag is one nobody brought.
  return [...drawn].filter((name) => !new RegExp(`(^|[^<\\w$/.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'm').test(text) && name !== 'React' && name !== 'Fragment').sort();
}

/** What a browser gives a page without an import. */
const BROWSER_GIVEN = new Set(
  'parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame structuredClone queueMicrotask getComputedStyle matchMedia addEventListener removeEventListener scrollTo scrollBy requestIdleCallback cancelIdleCallback createImageBitmap reportError'.split(
    ' ',
  ),
);

/**
 * The helpers a screen calls (`formatMoney(price)`) that it neither imports
 * nor declares: the build passes, and the page is blank with "formatMoney is
 * not defined". Only a name in two words or more (camelCase), which no plain
 * text is; a name that stands anywhere but before a `(`, or is defined where
 * it stands (`loadRows() {`), was brought or made somewhere.
 */
export function unbroughtCalls(source: string): string[] {
  const text = code(source).replace(/'[^'\n]*'|"[^"\n]*"/g, (quoted) => quoted[0] + ' '.repeat(quoted.length - 2) + quoted[0]);
  const called = new Map<string, number[]>();
  // Written as a call is: the name and its bracket with nothing between ("seeMore (soon)" is a sentence).
  for (const found of text.matchAll(/(^|[^.\w$])([a-z][a-z0-9]*[A-Z][\w$]*)\(/gm)) {
    const name = found[2] as string;
    called.set(name, [...(called.get(name) ?? []), found.index + found[0].length - 1]);
  }
  const missing: string[] = [];
  for (const [name, at] of called) {
    if (BROWSER_GIVEN.has(name)) continue;
    // Anywhere it is not called: an import, a declaration, an argument, a value handed on.
    if (new RegExp(`(^|[^.\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$]|\\s*\\()`, 'm').test(text)) continue;
    if (new RegExp(`\\bfunction\\s*\\*?\\s*${name.replace(/\$/g, '\\$')}\\s*[(<]`).test(text)) continue;
    // Defined where it stands: `name(…) {` in an object or a class.
    const defined = at.some((open) => {
      let depth = 0;
      for (let i = open; i < text.length && i < open + 2000; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') {
          depth -= 1;
          if (depth === 0) return /^\s*(?::[^{=;]{1,120})?\s*\{/.test(text.slice(i + 1, i + 160));
        }
      }
      return true;
    });
    if (!defined) missing.push(name);
  }
  return missing.sort();
}

/**
 * A picture a screen shows from an address it wrote out itself: a path on
 * this server (`/apps/…/hero.jpg`, `./hero.jpg`) that no build brings there.
 * A picture a screen imports, one a function gives (`pictureUrl(row.picture)`),
 * one of another site (said elsewhere), an inline one and a file of the
 * public API are none of these. The first such address, or null.
 */
export function unbroughtPicture(source: string): string | null {
  const text = code(source);
  for (const found of text.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|\{\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)\s*\})/g)) {
    const address = (found[1] ?? found[2] ?? found[3] ?? found[4] ?? '').trim();
    if (address === '' || /^(?:https?:|data:|blob:|#|\$\{)/i.test(address) || address.startsWith('//') || address.startsWith('/api/')) continue;
    // Only what is plainly a picture's file, or a path into the app's own folder: `/files/${id}` may be a route of the screen's own.
    if (!/\.(?:jpe?g|png|webp|gif|avif|svg)(?:[?#'`$ ]|$)/i.test(address) && !address.startsWith('/apps/')) continue;
    return address.slice(0, 80);
  }
  return null;
}

/** The import that brings the page-address helper, written out: a model follows the words it is given. */
const ADDRESS_HELPER = "import { Link, usePath, pathParams, go } from '@adminiumjs/adminium/side'";

/** Whether a file brings a part of the side module that reads or changes the page's address (`usePath`, `Link`, `go`). */
export function readsAddress(source: string): boolean {
  for (const found of code(source).matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*['"]@adminiumjs\/adminium\/side['"]/g)) {
    if ((found[1] as string).split(',').some((name) => /^\s*(?:usePath|Link|go)\s*$/.test(name))) return true;
  }
  return false;
}

/**
 * A link a screen writes from the server's root (`href="/menu"`): on a side,
 * which is served under `/apps/<key>/<side>/`, it leaves the app. An address
 * of another site, of the public API, a place on the page and one a function
 * gives are none of these. The first such address, or null.
 */
export function rootedLink(source: string): string | null {
  for (const found of code(source).matchAll(/\bhref\s*=\s*(?:"([^"]*)"|\{\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)\s*\})/g)) {
    const address = found[1] ?? found[2] ?? found[3] ?? found[4] ?? '';
    if (address.startsWith('/') && !address.startsWith('//') && !address.startsWith('/api/')) return address.slice(0, 60);
  }
  return null;
}

/**
 * The state a screen keeps its page in: `const [page, …] = useState('home')`,
 * by the state's name (page, screen, view, route) and a first value that is
 * text. A number is rows turned a page at a time, not a page of the side. The
 * state's name, or null. Never a sign on its own, and never said as a fact:
 * "view" and "page" name much that is no page (a grid or a list).
 */
export function pageState(source: string): string | null {
  for (const found of code(source).matchAll(/\bconst\s*\[\s*(page|screen|view|route)\s*,[^\]]*\]\s*=\s*(?:React\.)?useState\s*(?:<([^>(]*)>)?\s*\(\s*(['"`])?/g)) {
    if (found[3] !== undefined || /['"`]|\bstring\b/.test(found[2] ?? '')) return found[1] as string;
  }
  return null;
}

/** The folders a side's pages are kept in, when it keeps them apart. */
const PAGE_FOLDERS = ['pages', 'screens', 'views'] as const;

/** How many colour values a stylesheet of the app's own may hold before it is said: a shadow or a gradient needs one or two. */
const COLOURS_ALLOWED = 3;

const PALETTE_CLASS =
  /^(?:[a-z0-9-]+:)*(?:bg|text|border(?:-[xytrblse])?|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|divide|shadow|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)(?:\/\d{1,3})?$/;

/** Whether a class is one of Tailwind's own palette colours (`bg-red-500`, `md:hover:text-slate-700/80`): a colour the theme knows nothing of. */
export const isPaletteClass = (name: string): boolean => PALETTE_CLASS.test(name);

/** The theme's values a stylesheet may name, as the colours they are in one set. */
function themeValues(set: ThemeColours): Map<string, string> {
  const accent2 = set.accent2 ?? set.accent;
  const band = set.band ?? set.text;
  return new Map([
    ['bg', set.bg],
    ['surface', set.surface],
    ['surface-2', set.surface2],
    ['text', set.text],
    ['muted', set.muted],
    ['line', set.line],
    ['accent', set.accent],
    ['accent-2', accent2],
    ['band', band],
    ['accent-ink', inkOn(set.accent)],
    ['accent-2-ink', inkOn(accent2)],
    ['band-ink', inkOn(band)],
  ]);
}

/** The ink that reads on a background of the theme's, by its name. */
const INK_FOR: Record<string, string> = { accent: 'accent-ink', 'accent-2': 'accent-2-ink', band: 'band-ink' };

/**
 * Rules of a stylesheet that set both the text's colour and the background to
 * values of the theme that do not read on each other (under 4.5:1, in the
 * light set or the dark). Only a rule that names both, each as one plain
 * `var(--name)`: a colour that comes from a parent, a gradient or a mix is not
 * something this can read, and nothing is said of it.
 */
export function lowContrastRules(css: string, theme: Pick<Theme, 'light' | 'dark'>): { selector: string; text: string; on: string }[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const sets = [themeValues(theme.light), themeValues(theme.dark)];
  const value = (decls: string, property: RegExp): string | null => {
    let found: string | null = null;
    for (const decl of decls.split(';')) {
      const at = decl.indexOf(':');
      if (at < 0 || !property.test(decl.slice(0, at).trim())) continue;
      const named = /^var\(\s*--([a-z0-9-]+)\s*\)(?:\s*!important)?$/.exec(decl.slice(at + 1).trim());
      // The last one written wins; one that is no plain theme value hides what came before it.
      found = named === null ? null : (named[1] as string);
    }
    return found;
  };
  const out: { selector: string; text: string; on: string }[] = [];
  for (const rule of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] as string).trim().replace(/\s+/g, ' ');
    // A control that is switched off is meant to read faintly.
    if (selector.startsWith('@') || /:disabled|\[disabled|aria-disabled/.test(selector)) continue;
    const text = value(rule[2] as string, /^color$/);
    const on = value(rule[2] as string, /^background(?:-color)?$/);
    if (text === null || on === null) continue;
    if (sets.some((set) => set.has(text) && set.has(on) && contrast(set.get(text) as string, set.get(on) as string) < 4.5)) out.push({ selector: selector.slice(0, 60), text, on });
  }
  return out;
}

/** Words of a request that ask for more than a look: something to keep, list or work with. */
const MORE_THAN_LOOK = /\b(fields?|columns?|tables?|dashboard|pages?|lists?|forms?|filters?|reports?|charts?|status(es)?|track|records?|rows?|import|export|permissions?|roles?)\b/i;

/**
 * One line when a turn that was asked only for a look wrote a dashboard page:
 * those are Adminium's own and take no design. `written` are the paths the
 * turn's steps wrote, as the model gave them.
 */
export function dashboardPageLine(request: string, written: readonly string[]): string | null {
  if (!mentionsLook(request) || MORE_THAN_LOOK.test(request)) return null;
  const page = written.map((path) => path.replace(/\\/g, '/').replace(/^\.?\//, '')).find((path) => /(^|\/)manifest\/pages\/[^/]+\.json$/.test(path) || /^pages\/[^/]+\.json$/.test(path));
  if (page === undefined) return null;
  return `- ${page} is a dashboard page, and this turn was asked for a look: dashboard pages are Adminium's own and take no design. If the change there was not asked for, put the page back as it was; the look belongs in the app's own screens (set_style, design.css).`;
}

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
    const palette = new Map<string, string>();
    for (const screen of screens) {
      for (const name of classesIn(screen.text)) {
        if (!defined.has(name) && !used.has(name)) used.set(name, screen.name);
        if (isPaletteClass(name) && !palette.has(name)) palette.set(name, screen.name);
      }
    }
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

    // A colour of Tailwind's own palette: it compiles, and the theme knows nothing of it.
    if (tailwind !== null && !('problem' in tailwind) && palette.size > 0) {
      const names = [...palette.keys()].sort();
      issues.push({
        kind: 'colour',
        line: `- ${at(palette.get(names[0] as string) as string)} uses Tailwind's own colours (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}): use the theme's in their place (bg-accent, text-muted, bg-surface, border-line, bg-band; for an error or a state: text-bad, bg-good, text-warn), and to change a colour call set_style with a "theme". Then the style menu and dark mode keep working.`,
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
        for (const rule of lowContrastRules(sheet.text, theme).slice(0, 4)) {
          issues.push({
            kind: 'contrast',
            line: `- ${at(sheet.name)}: "${rule.selector}" puts var(--${rule.text}) on var(--${rule.on}), which is hard to read: on that background use var(--${INK_FOR[rule.on] ?? 'text'})${INK_FOR[rule.on] === undefined ? ', or a background the text reads on' : ''}.`,
          });
        }
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
    // A component drawn and never brought: the page would be blank.
    for (const screen of screens) {
      const names = unbroughtComponents(screen.text);
      if (names.length === 0) continue;
      issues.push({
        kind: 'component',
        line: `- ${at(screen.name)} draws ${names.slice(0, 4).map((name) => `<${name}>`).join(', ')} and neither imports nor declares ${names.length === 1 ? 'it' : 'them'}: the build passes and the whole page comes up blank ("${names[0] as string} is not defined"). Import ${names.length === 1 ? 'it' : 'each'} from where it is (a ready part: './ui/…'; an icon: 'lucide-react'), or use a plain element.`,
      });
    }

    // A helper called and never brought: the same blank page.
    for (const screen of screens) {
      const names = unbroughtCalls(screen.text);
      if (names.length === 0) continue;
      issues.push({
        kind: 'component',
        line: `- ${at(screen.name)} calls ${names.slice(0, 4).map((name) => `${name}()`).join(', ')} and neither imports nor declares ${names.length === 1 ? 'it' : 'them'}: the build passes and the whole page comes up blank ("${names[0] as string} is not defined"). Import ${names.length === 1 ? 'it' : 'each'} from the package that has it, or write the few lines in this file (money: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(amount), with the currency always given).`,
      });
    }

    // A picture from an address the screen made up: nothing is there, and the page shows an empty frame.
    for (const screen of screens) {
      const address = unbroughtPicture(screen.text);
      // A file the side brings as it is (its public/ folder) is there.
      if (address === null || (!address.startsWith('/') && !address.includes('${') && existsSync(join(dir, side, 'public', address.replace(/^\.\//, ''))))) continue;
      issues.push({
        kind: 'pictures',
        line: `- ${at(screen.name)} shows a picture from "${address}", an address nothing is at, so an empty frame shows. A page's picture is a file the screen imports (call find_pictures with "for": "page", then import hero1 from '../../assets/pictures/hero-1.jpg'); a row's picture comes from its picture column with pictureUrl. With no picture to show, take the <img> out and leave the tile plain.`,
      });
    }
    // More than one page, and one address for all of them. One line a side.
    {
      const reads = sources(src, /\.(?:tsx?|jsx?)$/).some((file) => readsAddress(file.text));
      let listed = 0;
      if (side === 'staff') {
        try {
          const nav: unknown = JSON.parse(readFileSync(join(dir, side, 'nav.json'), 'utf8'));
          listed = Array.isArray(nav) ? nav.length : 0;
        } catch {
          // No nav file, or one that cannot be read: the build says that.
        }
      }
      const folder = PAGE_FOLDERS.map((name) => ({ name, files: screens.filter((screen) => screen.name.startsWith(`${name}/`)).length })).sort((a, b) => b.files - a.files)[0];
      const rooted = screens.map((screen) => ({ screen, address: rootedLink(screen.text) })).find((entry) => entry.address !== null);
      const hashed = screens.find((screen) => /\blocation\.hash\b|['"]hashchange['"]/.test(code(screen.text)));
      if (!reads && (listed > 1 || (folder !== undefined && folder.files > 1))) {
        const state = screens.map((screen) => pageState(screen.text)).find((name) => name !== null);
        const sign = listed > 1 ? `${appPath(key, side, 'nav.json')} lists ${String(listed)} screens` : `${String(folder?.files ?? 0)} files under src/${folder?.name ?? ''}/`;
        issues.push({
          kind: 'address',
          line:
            `- ${appPath(key, side, 'src')}/ shows more than one page (${sign}) and none has an address of its own. Every page is at "/", so ${side === 'staff' ? "each entry of the dashboard's sidebar opens the same first screen" : 'a page cannot be refreshed, sent to somebody or gone back to'}. ` +
            `Give each page an address with the side module's helper: ${ADDRESS_HELPER}. In the component that chooses what to draw, const path = usePath() (before any return); path === '/' is the first page, and pathParams('/menu/:slug', path) gives { slug } for a page with a part of its own, or null for another page. Move with <Link to="/menu">…</Link> or go('/menu'), never by setting a state${state === undefined || state === null ? '' : ` (if const [${state}, …] = useState is what chooses the page, the path takes its place)`}. For a path that is none of the pages draw "This page does not exist" with a <Link to="/">.` +
            (side === 'staff' ? ' Each "path" in nav.json is its page\'s address without the first slash: "" is "/", "done" is "/done".' : ''),
        });
      } else if (rooted !== undefined) {
        const address = rooted.address as string;
        issues.push({
          kind: 'address',
          line: `- ${at(rooted.screen.name)} links with href="${address}", an address from the server's root: a side is served under /apps/<key>/<side>/, so that link leaves the app's pages. Write ${address.includes('${') ? `<Link to={\`${address}\`}>` : `<Link to="${address}">`}…</Link> with the page's own path (import { Link } from '@adminiumjs/adminium/side'): it adds where the side is served.`,
        });
      } else if (hashed !== undefined) {
        issues.push({
          kind: 'address',
          line: `- ${at(hashed.name)} keeps the page in the address's hash (window.location.hash): a side's pages have real addresses. Read the page with const path = usePath() and move with <Link to="/menu">…</Link> or go('/menu') (${ADDRESS_HELPER}).`,
        });
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

  // A public page with no picture on it at all, where pictures can be looked for: asked once, while the app is being made.
  if (opts.fresh === true && opts.emptyPictureColumns !== undefined && sides.includes('customer' as AppSide)) {
    const screens = sources(join(dir, 'customer', 'src'), /\.(?:tsx|jsx)$/).filter((screen) => !screen.name.startsWith('ui/'));
    const pictured = screens.some((screen) => {
      const text = code(screen.text);
      return /assets\/pictures\/|pictureUrl\s*\(|<img\b(?![^>]*\blogo\b)[^>]*\bsrc\s*=\s*\{(?!\s*logo\b)|\bimport\s+\w+\s+from\s*['"][^'"]+\.(?:jpe?g|png|webp|avif)['"]/.test(text);
    }) || sources(join(dir, 'customer', 'src'), /\.css$/).some((sheet) => sheet.name !== 'app.css' && /background(?:-image)?\s*:[^;]*url\(/.test(sheet.text));
    if (screens.length > 0 && !pictured && opts.emptyPictureColumns.length === 0) {
      issues.push({
        kind: 'pictures',
        line: `- The public page shows no picture at all, only words: a page for a business needs at least one of the place, the work or what is on offer. Call find_pictures once with what the first screen should show ("for": "page") and, where customers choose from a list, the list's rows ("for": "rows", with its "table"); then show them. If the person asked for a page without pictures, say so and leave it.`,
      });
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
