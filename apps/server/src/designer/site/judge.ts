// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The judge of a site template: one set of rules for every way a template comes in (a zip now, a
 * project's folder later). A reader hands it a list of entries (a path, a declared size, what the
 * entry is, a way to read its bytes); it decides what is kept, what is left out with a reason, and
 * what refuses the whole template with one sentence naming the file.
 *
 * Refused whole: a path that could land anywhere but where it says (`..` or `.` as a part, a
 * leading `/`, a drive letter, a backslash, a control character), a name Windows cannot hold (a
 * colon, a trailing dot or space, a device name such as `con` or `com1`, at any depth), two paths
 * that are one once folded (NFC and full case folding), and any limit passed.
 *
 * Left out and listed: links and other non-files, hidden files, PHP, SCSS and Less, source maps,
 * build files, videos and sounds, a zip inside, a picture or font whose bytes are not what its name
 * says, an SVG that can run something, text that is not UTF-8, and anything not a kept kind. What
 * an operating system adds by itself (`__MACOSX`, `.DS_Store`, `Thumbs.db`) is left out unlisted.
 *
 * Kept, judged by the bytes then the name: pictures (PNG, JPEG, GIF, WebP, AVIF, ICO), safe SVG,
 * fonts (woff2, woff, ttf, otf, eot), pages, stylesheets, scripts (UTF-8, no NUL), and licence and
 * readme text. One folder that wraps everything is taken off.
 */
import { createHash } from 'node:crypto';

import { imageTypeOf } from '../picture-type.js';

export const SITE_MAX_ENTRIES = 1000;
export const SITE_MAX_FILES = 300;
export const SITE_MAX_BYTES = 24 * 1024 * 1024;
/** Folders a file may sit in, below the template's own top. */
export const SITE_MAX_DEPTH = 8;
export const SITE_MAX_PATH = 200;
/** The most reasons kept for the person to read; the count says how many there were. */
export const SITE_LEFT_OUT_LISTED = 100;

export type SiteFileKind = 'html' | 'css' | 'js' | 'picture' | 'svg' | 'font' | 'text';

/** Why a file was left out: a code the page says in the person's language, and its words here. */
export const LEFT_OUT_REASONS = {
  php: 'PHP is not used',
  video: 'videos are not kept',
  sound: 'sounds are not kept',
  scss: 'SCSS and Less are not used; their CSS is',
  map: 'source maps are not kept',
  zip: 'a zip inside the template is not opened',
  source: 'source code that needs a build is not used',
  'build-file': 'build files are not used',
  'build-folder': 'build folders are not used',
  hidden: 'hidden files are not kept',
  link: 'links are not followed',
  'not-file': 'it is not a file',
  kind: 'this kind of file is not kept',
  'not-picture': 'it is not the picture its name says',
  'not-font': 'it is not the font its name says',
  'svg-runs': 'it holds a script or a link that runs, so it is not kept',
  'not-svg': 'it is not an SVG picture',
  'not-text': 'it does not read as text',
} as const;
export type LeftOutReason = keyof typeof LEFT_OUT_REASONS;

const KB = 1024;
const MB = 1024 * KB;
/** The most one file of each kind may be. */
export const SITE_FILE_CAPS: Record<SiteFileKind, number> = { picture: 5 * MB, font: 1 * MB, html: 512 * KB, css: 1 * MB, js: 1 * MB, svg: 512 * KB, text: 64 * KB };
const CAP_WORDS: Record<SiteFileKind, [string, string]> = {
  picture: ['5 MB', 'a picture'],
  font: ['1 MB', 'a font'],
  html: ['512 KB', 'a page'],
  css: ['1 MB', 'a stylesheet'],
  js: ['1 MB', 'a script'],
  svg: ['512 KB', 'an SVG picture'],
  text: ['64 KB', 'a licence or readme'],
};

export interface SiteEntry {
  path: string;
  /** Its size as the reader declares it; the judge reads no more. */
  size: number;
  type: 'file' | 'dir' | 'link' | 'other';
  read(): Promise<Buffer>;
}

export interface JudgedFile {
  path: string;
  kind: SiteFileKind;
  bytes: Buffer;
  sha256: string;
}

export interface Judged {
  files: JudgedFile[];
  /** What was left out, each with its reason, at most `SITE_LEFT_OUT_LISTED` of them. */
  leftOut: { path: string; reason: LeftOutReason; why: string }[];
  leftOutCount: number;
  pages: number;
  bytes: number;
  /** One hash for what is kept, whichever way it came: the same template twice is the same site. */
  sha256: string;
}

export type SiteRefusalReason = 'SITE_PATH' | 'SITE_DUPLICATE' | 'SITE_LIMIT' | 'SITE_NOTHING';

/** A template refused whole, with the one sentence the person reads. */
export class SiteRefusal extends Error {
  override readonly name = 'SiteRefusal';
  constructor(
    readonly reason: SiteRefusalReason,
    message: string,
  ) {
    super(message);
  }
}

const EXT_KIND: Record<string, SiteFileKind> = {
  html: 'html',
  htm: 'html',
  css: 'css',
  js: 'js',
  mjs: 'js',
  png: 'picture',
  jpg: 'picture',
  jpeg: 'picture',
  gif: 'picture',
  webp: 'picture',
  avif: 'picture',
  ico: 'picture',
  svg: 'svg',
  woff2: 'font',
  woff: 'font',
  ttf: 'font',
  otf: 'font',
  eot: 'font',
};

/** Why a kind of file is left out, by its extension. */
const LEFT_OUT_BY_EXT: [RegExp, LeftOutReason][] = [
  [/^(php\d?|phtml)$/, 'php'],
  [/^(mp4|webm|mov|avi|mkv|m4v|ogv|wmv|flv)$/, 'video'],
  [/^(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/, 'sound'],
  [/^(scss|sass|less|styl)$/, 'scss'],
  [/^map$/, 'map'],
  [/^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/, 'zip'],
  [/^(ts|tsx|jsx|vue|svelte|coffee)$/, 'source'],
];
const BUILD_FILES = /^(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|composer\.json|composer\.lock|gulpfile\.js|gruntfile\.js|webpack\.config\.[cm]?js|vite\.config\.[cm]?[jt]s|rollup\.config\.[cm]?js|tailwind\.config\.[cm]?js|postcss\.config\.[cm]?js|bower\.json|makefile|dockerfile)$/i;
/** What an operating system adds by itself: left out without a word. */
const SYSTEM = (part: string): boolean => part === '__MACOSX' || part === '.DS_Store' || part === 'Thumbs.db' || part === 'desktop.ini' || part.startsWith('._');
const TEXT_NAME = /^(licen[cs]e|copying|notice|readme|credits|authors)(\.(txt|md|markdown))?$/i;
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** A path folded as two names that one file system would hold as one. */
export const foldPath = (path: string): string => path.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');

/** The parts of a path, refused whole when one of them could land anywhere but where it says. */
function partsOf(raw: string, label: string): string[] {
  const refuse = (why: string): SiteRefusal => new SiteRefusal('SITE_PATH', `${label} has a file ${why}.`);
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) throw refuse('whose name holds a control character');
  if (raw.includes('\\')) throw refuse(`whose name holds a backslash (${raw})`);
  if (raw.startsWith('/') || /^[a-z]:/i.test(raw)) throw refuse(`named from the top of a disk (${raw})`);
  const parts = raw.replace(/\/$/, '').split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') throw refuse(`whose name walks out of its folder (${raw})`);
    if (part.includes(':')) throw refuse(`whose name holds a colon, which Windows cannot hold (${raw})`);
    if (/[. ]$/.test(part)) throw refuse(`whose name ends in a dot or a space, which Windows cannot hold (${raw})`);
    if (DEVICE.test(part)) throw refuse(`named ${part}, a name Windows keeps for itself`);
  }
  return parts;
}

/** Whether a picture's bytes are a picture: the four any browser draws, AVIF and ICO. */
function isPicture(bytes: Buffer): boolean {
  if (imageTypeOf(bytes) !== null) return true;
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp' && /^avi[fs]$/.test(bytes.subarray(8, 12).toString('latin1'))) return true;
  return bytes.length >= 6 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
}

/** Whether a font's bytes are a font. */
function isFont(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 4).toString('latin1');
  if (head === 'wOF2' || head === 'wOFF' || head === 'OTTO' || head === 'true') return bytes.length >= 12;
  if (bytes.length >= 12 && bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) return true;
  // An EOT carries "LP" at byte 34.
  return bytes.length >= 36 && bytes[34] === 0x4c && bytes[35] === 0x50;
}

const textOf = (bytes: Buffer): string | null => {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

/** An SVG that can run something, or load a page: what makes one unsafe to keep. */
const SVG_RUNS = /<script|\son[a-z]+\s*=|<foreignobject|<!entity|<\?xml-stylesheet|javascript:|data:text\/html/i;

/** Judges a template's entries: what is kept, what is left out and why, or one sentence that refuses it whole. */
export async function judgeSite(label: string, entries: readonly SiteEntry[]): Promise<Judged> {
  if (entries.length > SITE_MAX_ENTRIES) throw new SiteRefusal('SITE_LIMIT', `${label} has more than ${SITE_MAX_ENTRIES.toLocaleString('en-US')} files and folders.`);
  const leftOut: { path: string; reason: LeftOutReason; why: string }[] = [];
  let leftOutCount = 0;
  const leave = (path: string, reason: LeftOutReason): void => {
    leftOutCount += 1;
    if (leftOut.length < SITE_LEFT_OUT_LISTED) leftOut.push({ path, reason, why: LEFT_OUT_REASONS[reason] });
  };

  // Every path is checked, junk too: a bad name refuses the template wherever it sits.
  const seen = new Map<string, string>();
  const kept: { entry: SiteEntry; parts: string[] }[] = [];
  for (const entry of entries) {
    const parts = partsOf(entry.path, label);
    if (parts.some(SYSTEM)) continue;
    const name = parts.join('/');
    const folded = foldPath(name);
    const before = seen.get(folded);
    if (before !== undefined && before !== name) throw new SiteRefusal('SITE_DUPLICATE', `Two files have the same name apart from capital letters: ${before} and ${name}.`);
    if (before === name && entry.type !== 'dir') throw new SiteRefusal('SITE_DUPLICATE', `${label} holds ${name} twice.`);
    seen.set(folded, name);
    kept.push({ entry, parts });
  }

  // One folder that wraps everything is taken off.
  const tops = new Set(kept.map(({ parts }) => parts[0]));
  const wrapped = tops.size === 1 && kept.every(({ entry, parts }) => parts.length > 1 || entry.type === 'dir');
  const candidates: { entry: SiteEntry; path: string; kind: SiteFileKind }[] = [];
  for (const { entry, parts: whole } of kept) {
    const parts = wrapped ? whole.slice(1) : whole;
    if (entry.type === 'dir' || parts.length === 0) continue;
    const path = parts.join('/');
    if (path.length > SITE_MAX_PATH) throw new SiteRefusal('SITE_LIMIT', `${label} has a file path over ${String(SITE_MAX_PATH)} characters (${path.slice(0, 60)}…).`);
    if (parts.length - 1 > SITE_MAX_DEPTH) throw new SiteRefusal('SITE_LIMIT', `${label} has a file more than ${String(SITE_MAX_DEPTH)} folders deep (${path}).`);
    if (entry.type === 'link') {
      leave(path, 'link');
      continue;
    }
    if (entry.type !== 'file') {
      leave(path, 'not-file');
      continue;
    }
    if (parts.some((part) => part.startsWith('.'))) {
      leave(path, 'hidden');
      continue;
    }
    if (parts.slice(0, -1).some((part) => part === 'node_modules')) {
      leave(path, 'build-folder');
      continue;
    }
    const file = parts[parts.length - 1] ?? '';
    const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase() ?? '';
    if (BUILD_FILES.test(file)) {
      leave(path, 'build-file');
      continue;
    }
    const kind = TEXT_NAME.test(file) ? 'text' : EXT_KIND[ext];
    if (kind === undefined) {
      leave(path, LEFT_OUT_BY_EXT.find(([pattern]) => pattern.test(ext))?.[1] ?? 'kind');
      continue;
    }
    if (entry.size > SITE_FILE_CAPS[kind]) {
      const [cap, what] = CAP_WORDS[kind];
      throw new SiteRefusal('SITE_LIMIT', `${path} is over ${cap}, larger than ${what} of a site template is.`);
    }
    candidates.push({ entry, path, kind });
  }
  if (candidates.length > SITE_MAX_FILES) throw new SiteRefusal('SITE_LIMIT', `${label} has more than ${String(SITE_MAX_FILES)} files to keep.`);
  // The whole archive stops at its limit before a byte is inflated: each read is held to its declared size.
  if (candidates.reduce((sum, each) => sum + each.entry.size, 0) > SITE_MAX_BYTES) throw new SiteRefusal('SITE_LIMIT', `${label} holds more than 24 MB of files to keep.`);

  const files: JudgedFile[] = [];
  for (const { entry, path, kind } of candidates) {
    const bytes = await entry.read();
    if (bytes.length > SITE_FILE_CAPS[kind] || bytes.length > entry.size) throw new SiteRefusal('SITE_LIMIT', `${path} is larger than it says.`);
    if (kind === 'picture' && !isPicture(bytes)) {
      leave(path, 'not-picture');
      continue;
    }
    if (kind === 'font' && !isFont(bytes)) {
      leave(path, 'not-font');
      continue;
    }
    if (kind !== 'picture' && kind !== 'font') {
      const text = textOf(bytes);
      if (text === null) {
        leave(path, 'not-text');
        continue;
      }
      if (kind === 'svg' && (!/<svg[\s>]/i.test(text) || SVG_RUNS.test(text))) {
        leave(path, /<svg[\s>]/i.test(text) ? 'svg-runs' : 'not-svg');
        continue;
      }
    }
    files.push({ path, kind, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  if (!files.some((file) => file.kind === 'html' || file.kind === 'css')) throw new SiteRefusal('SITE_NOTHING', `${label} holds no page or stylesheet of a site.`);
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    files: sorted,
    leftOut,
    leftOutCount,
    pages: files.filter((file) => file.kind === 'html').length,
    bytes: files.reduce((sum, file) => sum + file.bytes.length, 0),
    sha256: createHash('sha256')
      .update(sorted.map((file) => `${file.path}\u0000${file.sha256}\n`).join(''))
      .digest('hex'),
  };
}
